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
db_manager = DatabaseManager()
telemetry = TelemetryServer()
media_processor = MediaProcessor()

class ScanRequest(BaseModel):
    path: str

class TagRequest(BaseModel):
    tag_type: str
    value: str

class MarkerRequest(BaseModel):
    timestamp: float
    end_timestamp: float | None = None
    note: str | None = None

@app.on_event("startup")
async def startup_event():
    db_manager.init_db()

@app.get("/")
async def root():
    return {"message": "SceneFlow API is running"}

@app.get("/clips")
async def get_clips():
    return db_manager.get_all_clips_with_tags()

@app.get("/proxy/{clip_id}")
async def get_proxy(clip_id: str):
    with db_manager.get_session() as session:
        from app.core.database import MediaClip
        clip = session.query(MediaClip).filter(MediaClip.id == clip_id).first()
        if not clip or not clip.proxy_path:
            raise HTTPException(status_code=404, detail="Proxy not found")
        return FileResponse(clip.proxy_path)

@app.post("/clips/{clip_id}/status")
async def update_clip_status(clip_id: str, is_kept: bool):
    db_manager.update_clip_status(clip_id, is_kept)
    await telemetry.broadcast("clip_updated", {"clip_id": clip_id, "is_kept": is_kept})
    return {"status": "updated"}

@app.post("/clips/{clip_id}/tags")
async def add_tag(clip_id: str, request: TagRequest):
    db_manager.add_tag(clip_id, request.tag_type, request.value)
    await telemetry.broadcast("clip_updated", {"clip_id": clip_id})
    return {"status": "tag_added"}

@app.post("/clips/{clip_id}/markers")
async def add_marker(clip_id: str, request: MarkerRequest):
    db_manager.add_marker(clip_id, request.timestamp, request.end_timestamp, request.note)
    await telemetry.broadcast("clip_updated", {"clip_id": clip_id})
    return {"status": "marker_added"}

@app.get("/clips/{clip_id}/markers")
async def get_markers(clip_id: str):
    return db_manager.get_markers(clip_id)

@app.delete("/clips/{clip_id}/markers/{marker_id}")
async def remove_marker(clip_id: str, marker_id: str):
    db_manager.remove_marker(marker_id)
    await telemetry.broadcast("clip_updated", {"clip_id": clip_id})
    return {"status": "marker_removed"}

@app.delete("/clips/{clip_id}/tags/{tag_id}")
async def remove_tag(clip_id: str, tag_id: str):
    db_manager.remove_tag(tag_id)
    await telemetry.broadcast("clip_updated", {"clip_id": clip_id})
    return {"status": "tag_removed"}

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
    sequence = db_manager.create_sequence(request.name)
    return sequence

@app.post("/sequences/{sequence_id}/items")
async def add_sequence_item(sequence_id: str, request: SequenceItemRequest):
    item = db_manager.add_sequence_item(sequence_id, request.clip_id, request.position, request.notes)
    return item

@app.get("/sequences")
async def get_sequences():
    with db_manager.get_session() as session:
        from app.core.database import Sequence
        return session.query(Sequence).all()

@app.get("/sequences/{sequence_id}/export")
async def export_sequence(sequence_id: str):
    exporter = StoryboardExporter(db_manager)
    markdown = exporter.export_markdown_storyboard(sequence_id)
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(content=markdown, media_type="text/markdown")

@app.post("/scan")
async def scan_directory(request: ScanRequest):
    clips_data = await media_processor.scan_directory(request.path)
    new_clips_count = 0
    for data in clips_data:
        # Check if clip already exists to avoid duplicates
        existing = db_manager.get_session().query(MediaClip).filter(MediaClip.file_path == data['file_path']).first()
        if not existing:
            new_clip = MediaClip(
                file_path=data['file_path'],
                file_name=data['file_name'],
                resolution=data['resolution'],
                frame_rate=data['frame_rate'],
                orientation=data['orientation'],
                proxy_path=data['proxy_path']
            )
            db_manager.add_clip(new_clip)
            new_clips_count += 1
            # Trigger proxy generation in background
            asyncio.create_task(media_processor.generate_proxy(new_clip.id, new_clip.file_path, db_manager, telemetry))
    
    await telemetry.broadcast("scan_complete", {"new_clips": new_clips_count, "total_found": len(clips_data)})
    return {"new_clips": new_clips_count, "total_found": len(clips_data)}
