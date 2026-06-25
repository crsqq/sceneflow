import asyncio
import json
import logging
import os
import re
import subprocess
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_PROXY_CONCURRENCY = 3


class MediaProcessor:
    """Handles FFmpeg command orchestration and monitoring."""

    def __init__(self, project_dir: str | None = None, max_concurrent_proxies: int | None = None):
        self.project_dir = project_dir
        if max_concurrent_proxies is None:
            try:
                max_concurrent_proxies = int(os.environ.get("SCENEFLOW_PROXY_CONCURRENCY", DEFAULT_PROXY_CONCURRENCY))
            except ValueError:
                max_concurrent_proxies = DEFAULT_PROXY_CONCURRENCY
        self.proxy_semaphore = asyncio.Semaphore(max(1, max_concurrent_proxies))
        self._queue_lock = asyncio.Lock()
        self._queued = 0
        self._completed = 0
        self._failed = 0

    def set_project_dir(self, project_dir: str):
        """Update the project root used for proxy/thumbnail output."""
        self.project_dir = project_dir

    async def _reset_queue_counters(self, total: int):
        async with self._queue_lock:
            self._queued = total
            self._completed = 0
            self._failed = 0

    async def _mark_done(self, failed: bool = False):
        async with self._queue_lock:
            self._completed += 1
            if failed:
                self._failed += 1
            return self._completed, self._queued, self._failed

    async def scan_directory(self, path: str) -> list[dict]:
        """Recursively finds video files and extracts technical metadata."""
        video_extensions = (".mp4", ".mov", ".mkv", ".avi")
        clips = []

        def _scan_sync():
            for root, dirs, files in os.walk(path):
                # Skip .sceneflow directories
                dirs[:] = [d for d in dirs if d != ".sceneflow"]

                for file in files:
                    if file.lower().endswith(video_extensions):
                        full_path = str(Path(root) / file)
                        metadata = self._get_metadata(full_path)
                        if metadata:
                            clips.append(metadata)
            return clips

        return await asyncio.to_thread(_scan_sync)

    def _get_metadata(self, file_path: str) -> dict | None:
        """Uses ffprobe to extract metadata."""
        try:
            cmd = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file_path]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            data = json.loads(result.stdout)

            # Find the video stream
            video_stream = next((s for s in data.get("streams", []) if s["codec_type"] == "video"), None)
            if not video_stream:
                return None

            width = int(video_stream.get("width", 0))
            height = int(video_stream.get("height", 0))

            exif = self._get_exif_metadata(file_path)

            recorded_at = exif.get("recorded_at")
            latitude = exif.get("latitude")
            longitude = exif.get("longitude")
            srt_detected = False

            if file_path.lower().endswith(".mp4"):
                srt = self._parse_srt_metadata(file_path)
                if srt.get("srt_detected"):
                    srt_detected = True
                    if srt.get("latitude") is not None:
                        latitude = srt["latitude"]
                        longitude = srt["longitude"]
                    if srt.get("recorded_at") is not None:
                        recorded_at = srt["recorded_at"]

            # Determine orientation: check rotation first, then fall back to width/height comparison
            rotation = exif.get("rotation")
            if rotation == 90 or rotation == 270:
                orientation = "portrait"
                # Swap width/height for rotated videos
                display_width, display_height = height, width
            else:
                orientation = "portrait" if height > width else "landscape"
                display_width, display_height = width, height

            return {
                "file_path": file_path,
                "file_name": Path(file_path).name,
                "resolution": f"{display_width}x{display_height}",
                "frame_rate": self._parse_fps(video_stream.get("avg_frame_rate", "0/0")),
                "orientation": orientation,
                "recorded_at": recorded_at,
                "latitude": latitude,
                "longitude": longitude,
                "srt_detected": srt_detected,
                "proxy_path": "",  # To be filled later
                "thumbnail_path": "",  # To be filled later
            }
        except (subprocess.SubprocessError, json.JSONDecodeError, KeyError, ValueError) as e:
            logger.error("Error extracting metadata for %s: %s", file_path, e)
            return None

    def _parse_fps(self, fps_str: str) -> float:
        try:
            num, den = map(int, fps_str.split("/"))
            return num / den if den != 0 else 0.0
        except (ValueError, ZeroDivisionError):
            return 0.0

    def _get_exif_metadata(self, file_path: str) -> dict:
        """Uses exiftool to extract CreateDate, GPS coordinates, and Rotation.

        Returns a dict with keys recorded_at (datetime or None), latitude (float or None),
        longitude (float or None), rotation (int or None). If exiftool returns no value for a field, it is None.
        """
        result = {"recorded_at": None, "latitude": None, "longitude": None, "rotation": None}
        try:
            cmd = ["exiftool", "-time:CreateDate", "-GPSLatitude", "-GPSLongitude", "-Rotation", "-n", "-j", file_path]
            proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
            data = json.loads(proc.stdout)
            logger.info("exiftool JSON output for %s: %s", file_path, proc.stdout)
            if not data:
                return result
            entry = data[0]

            create_date = entry.get("CreateDate")
            if create_date:
                try:
                    result["recorded_at"] = datetime.strptime(create_date, "%Y:%m:%d %H:%M:%S").replace(tzinfo=UTC)
                except ValueError:
                    logger.warning("Could not parse CreateDate '%s' for %s", create_date, file_path)

            lat = entry.get("GPSLatitude")
            lon = entry.get("GPSLongitude")
            if lat is not None:
                result["latitude"] = float(lat)
            if lon is not None:
                result["longitude"] = float(lon)

            rotation = entry.get("Rotation")
            if rotation is not None:
                result["rotation"] = int(rotation)
                logger.info("Rotation for %s: %s", file_path, rotation)
            else:
                logger.info("No rotation found for %s", file_path)
        except (subprocess.SubprocessError, json.JSONDecodeError, ValueError) as e:
            logger.error("Error extracting exif metadata for %s: %s", file_path, e)
        return result

    _SRT_COORD_RE = re.compile(r"\[latitude:\s*([-\d.]+)\]\s*\[longitude:\s*([-\d.]+)\]")
    _SRT_DT_RE = re.compile(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})")

    def _parse_srt_metadata(self, file_path: str) -> dict:
        """Check for a DJI-style .SRT sidecar next to an .MP4 and extract the first GPS fix and datetime."""
        parent = Path(file_path).parent
        stem = Path(file_path).stem
        srt_path = None
        for candidate in (parent / (stem + ".SRT"), parent / (stem + ".srt")):
            if candidate.is_file():
                srt_path = candidate
                break
        if srt_path is None:
            return {}
        try:
            recorded_at = None
            with Path(srt_path).open(encoding="utf-8", errors="replace") as f:
                for line in f:
                    if recorded_at is None:
                        m_dt = self._SRT_DT_RE.search(line)
                        if m_dt:
                            with suppress(ValueError):
                                recorded_at = datetime.strptime(m_dt.group(1), "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
                    m = self._SRT_COORD_RE.search(line)
                    if m:
                        return {
                            "srt_detected": True,
                            "recorded_at": recorded_at,
                            "latitude": float(m.group(1)),
                            "longitude": float(m.group(2)),
                        }
            if recorded_at is not None:
                return {"srt_detected": True, "recorded_at": recorded_at}
        except OSError as e:
            logger.warning("Could not read SRT sidecar %s: %s", srt_path, e)
        return {"srt_detected": True}

    async def generate_proxy(self, clip_id: str, source_path: str, db_manager, telemetry) -> None:
        """Background task using FFmpeg to create low-res proxies and a poster thumbnail."""
        async with self.proxy_semaphore:
            await self._generate_proxy_inner(clip_id, source_path, db_manager, telemetry)

    async def _generate_proxy_inner(self, clip_id: str, source_path: str, db_manager, telemetry) -> None:
        """Actual proxy/thumbnail generation, guarded by the concurrency semaphore."""
        # 1. Determine proxy directory: <project_dir>/.sceneflow/proxies/
        project_dir = Path(self.project_dir) if self.project_dir else Path(source_path).parent
        sceneflow_dir = Path(project_dir) / ".sceneflow"
        proxies_dir = sceneflow_dir / "proxies"
        thumbs_dir = sceneflow_dir / "thumbs"
        proxies_dir.mkdir(parents=True, exist_ok=True)
        thumbs_dir.mkdir(parents=True, exist_ok=True)

        file_name = Path(source_path).name
        base_name = Path(source_path).stem
        proxy_filename = f"{base_name}_proxy.mp4"
        proxy_path = str(proxies_dir / proxy_filename)
        thumb_filename = f"{base_name}_thumb.jpg"
        thumbnail_path = str(thumbs_dir / thumb_filename)

        try:
            logger.info("Generating proxy for %s -> %s", source_path, proxy_path)
            await telemetry.broadcast("proxy_started", {"clip_id": clip_id, "file_name": file_name})

            # Check for rotation to adjust scale filter
            exif = self._get_exif_metadata(source_path)
            rotation = exif.get("rotation")

            # FFmpeg command for low-res proxy (e.g., 720p, h264)
            # Use swapped dimensions for rotation 90
            if rotation == 90:
                proxy_scale = "scale=720:-2"
                thumb_scale = "scale=-2:320"
            else:
                proxy_scale = "scale=-2:720"
                thumb_scale = "scale=320:-2"

            proxy_cmd = [
                "ffmpeg",
                "-y",
                "-i",
                source_path,
                "-vf",
                proxy_scale,
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "28",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                proxy_path,
            ]

            # Thumbnail: single frame at 1s or 0.5s if shorter, scaled to 320px width
            thumb_cmd = [
                "ffmpeg",
                "-y",
                "-i",
                source_path,
                "-ss",
                "00:00:01.000",
                "-vframes",
                "1",
                "-vf",
                thumb_scale,
                "-q:v",
                "2",
                thumbnail_path,
            ]

            # Use asyncio.create_subprocess_exec for non-blocking execution
            proxy_process = await asyncio.create_subprocess_exec(
                *proxy_cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            _proxy_stdout, proxy_stderr = await proxy_process.communicate()

            if proxy_process.returncode != 0:
                raise RuntimeError(f"FFmpeg proxy error: {proxy_stderr.decode()}")

            # Generate thumbnail (best-effort; don't fail proxy if thumbnail fails)
            try:
                thumb_process = await asyncio.create_subprocess_exec(
                    *thumb_cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
                _thumb_stdout, thumb_stderr = await thumb_process.communicate()
                if thumb_process.returncode != 0:
                    logger.warning("Thumbnail generation failed for %s: %s", source_path, thumb_stderr.decode())
                    thumbnail_path = ""
            except subprocess.SubprocessError as thumb_err:
                logger.warning("Thumbnail generation exception for %s: %s", source_path, thumb_err)
                thumbnail_path = ""

            # 2. Update database
            from app.core.database import MediaClip

            with db_manager.get_session() as session:
                clip = session.query(MediaClip).filter(MediaClip.id == clip_id).first()
                if clip:
                    clip.proxy_path = proxy_path
                    if thumbnail_path:
                        clip.thumbnail_path = thumbnail_path
                    session.commit()

            await telemetry.broadcast(
                "proxy_completed",
                {
                    "clip_id": clip_id,
                    "proxy_path": proxy_path,
                    "thumbnail_path": thumbnail_path,
                },
            )
            logger.info("Proxy generated successfully: %s", proxy_path)

        except Exception as e:
            logger.error("Failed to generate proxy for %s: %s", source_path, e)
            await telemetry.broadcast("proxy_failed", {"clip_id": clip_id, "error": str(e)})
            raise

    async def process_proxy_queue(self, jobs: list[tuple[str, str]], db_manager, telemetry) -> None:
        """Process a batch of proxy jobs with bounded concurrency and broadcast queue progress."""
        if not jobs:
            return

        await self._reset_queue_counters(len(jobs))
        file_name_map = {clip_id: Path(path).name for clip_id, path in jobs}

        await telemetry.broadcast("proxy_queue_started", {"total": len(jobs)})

        async def _run_one(clip_id: str, source_path: str):
            try:
                await self.generate_proxy(clip_id, source_path, db_manager, telemetry)
                completed, total, failed = await self._mark_done(failed=False)
                await telemetry.broadcast(
                    "proxy_queue_progress",
                    {
                        "processed": completed,
                        "total": total,
                        "failed": failed,
                        "current_file": file_name_map.get(clip_id, ""),
                    },
                    progress=round(completed / max(total, 1) * 100, 1),
                )
            except Exception:  # noqa: BLE001
                completed, total, failed = await self._mark_done(failed=True)
                await telemetry.broadcast(
                    "proxy_queue_progress",
                    {
                        "processed": completed,
                        "total": total,
                        "failed": failed,
                        "current_file": file_name_map.get(clip_id, ""),
                    },
                    progress=round(completed / max(total, 1) * 100, 1),
                )

        await asyncio.gather(*(_run_one(clip_id, path) for clip_id, path in jobs))

        await telemetry.broadcast(
            "proxy_queue_complete", {"total": len(jobs), "completed": self._completed, "failed": self._failed}
        )
