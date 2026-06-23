import subprocess
import logging
import os
import glob
import json
import asyncio

logger = logging.getLogger(__name__)

class MediaProcessor:
    """Handles FFmpeg command orchestration and monitoring."""
    def __init__(self):
        pass

    async def scan_directory(self, path: str) -> list[dict]:
        """Recursively finds video files and extracts technical metadata."""
        video_extensions = ('.mp4', '.mov', '.mkv', '.avi')
        clips = []

        def _scan_sync():
            for root, dirs, files in os.walk(path):
                # Skip .sceneflow directories
                dirs[:] = [d for d in dirs if d != '.sceneflow']

                for file in files:
                    if file.lower().endswith(video_extensions):
                        full_path = os.path.join(root, file)
                        metadata = self._get_metadata(full_path)
                        if metadata:
                            clips.append(metadata)
            return clips

        return await asyncio.to_thread(_scan_sync)

    def _get_metadata(self, file_path: str) -> dict | None:
        """Uses ffprobe to extract metadata."""
        try:
            cmd = [
                'ffprobe', '-v', 'quiet', '-print_format', 'json',
                '-show_streams', '-show_format', file_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            data = json.loads(result.stdout)

            # Find the video stream
            video_stream = next((s for s in data.get('streams', []) if s['codec_type'] == 'video'), None)
            if not video_stream:
                return None

            width = int(video_stream.get('width', 0))
            height = int(video_stream.get('height', 0))

            return {
                "file_path": file_path,
                "file_name": os.path.basename(file_path),
                "resolution": f"{width}x{height}",
                "frame_rate": self._parse_fps(video_stream.get('avg_frame_rate', '0/0')),
                "orientation": "vertical" if height > width else "horizontal",
                "proxy_path": "", # To be filled later
                "thumbnail_path": "" # To be filled later
            }
        except Exception as e:
            logger.error(f"Error extracting metadata for {file_path}: {e}")
            return None

    def _parse_fps(self, fps_str: str) -> float:
        try:
            num, den = map(int, fps_str.split('/'))
            return num / den if den != 0 else 0.0
        except (ValueError, ZeroDivisionError):
            return 0.0

    async def generate_proxy(self, clip_id: str, source_path: str, db_manager, telemetry) -> None:
        """Background task using FFmpeg to create low-res proxies and a poster thumbnail."""
        import asyncio
        # 1. Determine proxy directory: <source_dir>/.sceneflow/proxies/
        source_dir = os.path.dirname(source_path)
        sceneflow_dir = os.path.join(source_dir, ".sceneflow")
        proxies_dir = os.path.join(sceneflow_dir, "proxies")
        thumbs_dir = os.path.join(sceneflow_dir, "thumbs")
        os.makedirs(proxies_dir, exist_ok=True)
        os.makedirs(thumbs_dir, exist_ok=True)

        file_name = os.path.basename(source_path)
        base_name, _ = os.path.splitext(file_name)
        proxy_filename = f"{base_name}_proxy.mp4"
        proxy_path = os.path.join(proxies_dir, proxy_filename)
        thumb_filename = f"{base_name}_thumb.jpg"
        thumbnail_path = os.path.join(thumbs_dir, thumb_filename)

        try:
            logger.info(f"Generating proxy for {source_path} -> {proxy_path}")
            await telemetry.broadcast("proxy_started", {"clip_id": clip_id, "file_name": file_name})

            # FFmpeg command for low-res proxy (e.g., 720p, h264)
            proxy_cmd = [
                'ffmpeg', '-y', '-i', source_path,
                '-vf', 'scale=-2:720',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-crf', '28', '-c:a', 'aac', '-b:a', '128k',
                proxy_path
            ]

            # Thumbnail: single frame at 1s or 0.5s if shorter, scaled to 320px width
            thumb_cmd = [
                'ffmpeg', '-y', '-i', source_path,
                '-ss', '00:00:01.000',
                '-vframes', '1',
                '-vf', 'scale=320:-2',
                '-q:v', '2',
                thumbnail_path
            ]

            # Use asyncio.create_subprocess_exec for non-blocking execution
            proxy_process = await asyncio.create_subprocess_exec(
                *proxy_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            proxy_stdout, proxy_stderr = await proxy_process.communicate()

            if proxy_process.returncode != 0:
                raise Exception(f"FFmpeg proxy error: {proxy_stderr.decode()}")

            # Generate thumbnail (best-effort; don't fail proxy if thumbnail fails)
            try:
                thumb_process = await asyncio.create_subprocess_exec(
                    *thumb_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                thumb_stdout, thumb_stderr = await thumb_process.communicate()
                if thumb_process.returncode != 0:
                    logger.warning(f"Thumbnail generation failed for {source_path}: {thumb_stderr.decode()}")
                    thumbnail_path = ""
            except Exception as thumb_err:
                logger.warning(f"Thumbnail generation exception for {source_path}: {thumb_err}")
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

            await telemetry.broadcast("proxy_completed", {"clip_id": clip_id, "proxy_path": proxy_path, "thumbnail_path": thumbnail_path})
            logger.info(f"Proxy generated successfully: {proxy_path}")

        except Exception as e:
            logger.error(f"Failed to generate proxy for {source_path}: {e}")
            await telemetry.broadcast("proxy_failed", {"clip_id": clip_id, "error": str(e)})
