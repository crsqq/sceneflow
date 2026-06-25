import json
import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class TelemetryServer:
    """Manages WebSocket connections and broadcasts event updates to the UI."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    async def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, event: str, data: dict, progress: float = 0.0):
        """Broadcasts a telemetry event to all connected clients."""
        message = json.dumps({"event": event, "data": data, "progress": progress})
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.error(f"Error broadcasting to websocket: {e}")
