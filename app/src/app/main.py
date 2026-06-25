import os
import asyncio
import logging
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from app.core.database import DatabaseManager, MediaClip
from app.core.telemetry import TelemetryServer
from app.core.media_engine import MediaProcessor

app = FastAPI(title="SceneFlow API")

# Enable CORS for Electron frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this to the Electron origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global instances for simplicity in MVP
db_manager: DatabaseManager | None = None
telemetry = TelemetryServer()
media_processor = MediaProcessor()


def set_project(project_dir: str):
    """Switch the global database and media processor to the given project root."""
    global db_manager, media_processor
    db_manager = DatabaseManager.for_project_dir(project_dir)
    media_processor.set_project_dir(project_dir)
    db_manager.init_db()

class ScanRequest(BaseModel):
    path: str

class TagRequest(BaseModel):
    tag_type: str
    value: str

class MarkerRequest(BaseModel):
    timestamp: float
    end_timestamp: float | None = None
    note: str | None = None

class CullRequest(BaseModel):
    is_kept: bool | None = None
    is_rejected: bool | None = None

class ClipMetadataRequest(BaseModel):
    short_name: str | None = None
    recorded_at: str | None = None
    latitude: float | None = None
    longitude: float | None = None

class ReorderRequest(BaseModel):
    item_ids: list[str]

@app.on_event("startup")
async def startup_event():
    # Database is initialized lazily when the first scan/project is opened.
    pass

@app.get("/")
async def root():
    return {"message": "SceneFlow API is running"}

@app.get("/clips")
async def get_clips(query: str = None):
    if db_manager is None:
        return []
    
    if query:
        result = db_manager.query_clips(query)
        return result
    
    return db_manager.get_all_clips_with_tags()

@app.get("/proxy/{clip_id}")
async def get_proxy(clip_id: str):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")
    with db_manager.get_session() as session:
        from app.core.database import MediaClip
        clip = session.query(MediaClip).filter(MediaClip.id == clip_id).first()
        if not clip or not clip.proxy_path:
            raise HTTPException(status_code=404, detail="Proxy not found")
        return FileResponse(clip.proxy_path)

@app.get("/thumbs/{clip_id}")
async def get_thumbnail(clip_id: str):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")
    with db_manager.get_session() as session:
        from app.core.database import MediaClip
        clip = session.query(MediaClip).filter(MediaClip.id == clip_id).first()
        if not clip or not clip.thumbnail_path or not os.path.exists(clip.thumbnail_path):
            raise HTTPException(status_code=404, detail="Thumbnail not found")
        return FileResponse(clip.thumbnail_path)

@app.post("/clips/{clip_id}/status")
async def update_clip_status(clip_id: str, is_kept: bool):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")
    db_manager.update_clip_status(clip_id, is_kept=is_kept)
    await telemetry.broadcast("clip_updated", {"clip_id": clip_id, "is_kept": is_kept})
    return {"status": "updated"}

@app.post("/clips/{clip_id}/cull")
async def cull_clip(clip_id: str, request: CullRequest):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")
    db_manager.update_clip_status(clip_id, is_kept=request.is_kept, is_rejected=request.is_rejected)
    await telemetry.broadcast("clip_updated", {"clip_id": clip_id, "is_kept": request.is_kept, "is_rejected": request.is_rejected})
    return {"status": "updated"}

@app.post("/clips/{clip_id}/tags")
async def add_tag(clip_id: str, request: TagRequest):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")
    db_manager.add_tag(clip_id, request.tag_type, request.value)
    await telemetry.broadcast("clip_updated", {"clip_id": clip_id})
    return {"status": "tag_added"}

@app.post("/clips/{clip_id}/markers")
async def add_marker(clip_id: str, request: MarkerRequest):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")
    db_manager.add_marker(clip_id, request.timestamp, request.end_timestamp, request.note)
    await telemetry.broadcast("clip_updated", {"clip_id": clip_id})
    return {"status": "marker_added"}

@app.get("/clips/{clip_id}/markers")
async def get_markers(clip_id: str):
    if db_manager is None:
        return []
    return db_manager.get_markers(clip_id)

@app.delete("/clips/{clip_id}/markers/{marker_id}")
async def remove_marker(clip_id: str, marker_id: str):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")
    db_manager.remove_marker(marker_id)
    await telemetry.broadcast("clip_updated", {"clip_id": clip_id})
    return {"status": "marker_removed"}

@app.delete("/clips/{clip_id}/tags/{tag_id}")
async def remove_tag(clip_id: str, tag_id: str):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")
    db_manager.remove_tag(tag_id)
    await telemetry.broadcast("clip_updated", {"clip_id": clip_id})
    return {"status": "tag_removed"}

@app.post("/clips/{clip_id}/metadata")
async def update_clip_metadata(clip_id: str, request: ClipMetadataRequest):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")

    recorded_at = None
    if request.recorded_at:
        try:
            recorded_at = datetime.fromisoformat(request.recorded_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid recorded_at format")

    db_manager.update_clip_metadata(
        clip_id,
        short_name=request.short_name,
        recorded_at=recorded_at,
        latitude=request.latitude,
        longitude=request.longitude
    )
    await telemetry.broadcast("clip_updated", {"clip_id": clip_id})
    return {"status": "metadata_updated"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await telemetry.connect(websocket)
    try:
        while True:
            # Keep connection alive and listen for any incoming messages if needed
            await websocket.receive_text()
    except WebSocketDisconnect:
        await telemetry.disconnect(websocket)

import asyncio
from app.core.exporter import StoryboardExporter

class SequenceRequest(BaseModel):
    name: str

class SequenceItemRequest(BaseModel):
    clip_id: str
    position: int
    notes: str | None = None

@app.post("/sequences")
async def create_sequence(request: SequenceRequest):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")
    sequence = db_manager.create_sequence(request.name)
    return sequence

@app.post("/sequences/{sequence_id}/items")
async def add_sequence_item(sequence_id: str, request: SequenceItemRequest):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")
    item = db_manager.add_sequence_item(sequence_id, request.clip_id, request.position, request.notes)
    return item

@app.get("/sequences/{sequence_id}/items")
async def get_sequence_items(sequence_id: str):
    if db_manager is None:
        return []
    return db_manager.get_sequence_items_with_clips(sequence_id)

@app.delete("/sequences/{sequence_id}/items/{item_id}")
async def remove_sequence_item(sequence_id: str, item_id: str):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")
    db_manager.remove_sequence_item(item_id)
    await telemetry.broadcast("sequence_updated", {"sequence_id": sequence_id})
    return {"status": "item_removed"}

@app.post("/sequences/{sequence_id}/reorder")
async def reorder_sequence_items(sequence_id: str, request: ReorderRequest):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")
    db_manager.reorder_sequence_items(sequence_id, request.item_ids)
    await telemetry.broadcast("sequence_updated", {"sequence_id": sequence_id})
    return {"status": "reordered"}

@app.get("/sequences")
async def get_sequences():
    if db_manager is None:
        return []
    with db_manager.get_session() as session:
        from app.core.database import Sequence
        return session.query(Sequence).all()

@app.get("/sequences/{sequence_id}/export")
async def export_sequence(sequence_id: str):
    if db_manager is None:
        raise HTTPException(status_code=503, detail="No project opened")
    exporter = StoryboardExporter(db_manager)
    markdown = exporter.export_markdown_storyboard(sequence_id)
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(content=markdown, media_type="text/markdown")

@app.post("/scan")
async def scan_directory(request: ScanRequest):
    project_dir = request.path
    set_project(project_dir)
    await telemetry.broadcast("scan_started", {"path": request.path})
    clips_data = await media_processor.scan_directory(request.path)
    new_clips_count = 0
    skipped_clips_count = 0
    total = len(clips_data)

    logger = logging.getLogger(__name__)
    logger.info(f"Scanning {request.path}: found {total} video file(s)")

    proxy_jobs: list[tuple[str, str]] = []

    for idx, data in enumerate(clips_data):
        await telemetry.broadcast(
            "scan_progress",
            {"processed": idx + 1, "total": total, "current_file": data['file_name']},
            progress=round((idx + 1) / max(total, 1) * 100, 1)
        )
        # Check if clip already exists to avoid duplicates
        with db_manager.get_session() as session:
            existing = session.query(MediaClip).filter(MediaClip.file_path == data['file_path']).first()
            if not existing:
                new_clip = MediaClip(
                    file_path=data['file_path'],
                    file_name=data['file_name'],
                    short_name=data.get('short_name'),
                    resolution=data['resolution'],
                    frame_rate=data['frame_rate'],
                    orientation=data['orientation'],
                    recorded_at=data.get('recorded_at'),
                    latitude=data.get('latitude'),
                    longitude=data.get('longitude'),
                    proxy_path=data['proxy_path'],
                    thumbnail_path=data['thumbnail_path']
                )
                session.add(new_clip)
                session.commit()
                session.refresh(new_clip)
                new_clips_count += 1
                clip_id = new_clip.id
                logger.info(f"Added clip: {data['file_name']} ({data['resolution']})")
                if data.get('srt_detected'):
                    db_manager.add_tag(clip_id, 'technical', 'Drone')
            else:
                skipped_clips_count += 1
                clip_id = None
                logger.info(f"Skipped duplicate: {data['file_name']}")

        if clip_id:
            proxy_jobs.append((clip_id, data['file_path']))

    await telemetry.broadcast(
        "scan_complete",
        {"new_clips": new_clips_count, "skipped_clips": skipped_clips_count, "total_found": total}
    )
    logger.info(f"Scan complete: {new_clips_count} new, {skipped_clips_count} skipped, {total} total")

    # Start proxy generation with bounded concurrency in the background
    if proxy_jobs:
        asyncio.create_task(media_processor.process_proxy_queue(proxy_jobs, db_manager, telemetry))

    return {"new_clips": new_clips_count, "skipped_clips": skipped_clips_count, "total_found": total}
