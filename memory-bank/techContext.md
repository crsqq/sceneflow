# Tech Context: SceneFlow

## Stack
- **Desktop Shell:** Electron (Node.js)
- **Backend:** FastAPI (Python 3.13+)
- **Database:** SQLite (Shadow Database)
- **Media Processing:** FFmpeg / ffprobe
- **Frontend:** Vanilla HTML/CSS + Alpine.js
- **Dependency Management:** 
    - Python: `uv`
    - Node.js: `npm`

## Development Setup
- **Backend:** Run via `uv run uvicorn app.main:app --reload` in the `app/` directory.
- **Frontend:** Run via `npm start` from the project root (starts Electron).

## Critical Constraints
- **Read-Only Media:** The application must never write to or modify source media files. All metadata and proxy files must be stored in the `.sceneflow` directory or project-local storage.
- **Hybrid Communication:** 
    - REST for standard commands (e.g., scan, status update).
    - WebSockets for telemetry and real-time progress updates.
