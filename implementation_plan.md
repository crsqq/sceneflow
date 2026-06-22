# Implementation Plan

[Overview]
Create a high-speed, local-first pre-visualization environment (SceneFlow) to bridge the gap between raw footage and professional NLE editing.

The implementation will follow a Desktop-Web Hybrid architecture using Electron for the desktop shell and FastAPI as a Python sidecar to handle heavy media processing. A "Shadow Database" (SQLite) will manage all metadata, tags, and sequences to ensure source media remains strictly read-only. The system will utilize automated proxy generation via FFmpeg for smooth 4K playback and a dual-protocol communication layer (REST for commands, WebSockets for telemetry). For the POC, the export functionality will generate a Markdown table summarizing the storyboarded sequence.

[Types]  
Single sentence describing the type system changes.
The system relies on a relational SQLite schema and structured JSON payloads for API communication.

- **SQLite Schema (Shadow Database):**
    - `media_clips`: `id` (UUID), `file_path` (TEXT, unique), `file_name` (TEXT), `resolution` (TEXT), `frame_rate` (REAL), `orientation` (TEXT: 'horizontal' | 'vertical'), `proxy_path` (TEXT), `is_kept` (BOOLEAN).
    - `tags`: `id` (UUID), `clip_id` (FK), `tag_type` (TEXT: 'technical' | 'creative'), `value` (TEXT).
    - `sequences`: `id` (UUID), `name` (TEXT), `created_at` (TIMESTAMP).
    - `sequence_items`: `id` (UUID), `sequence_id` (FK), `clip_id` (FK), `position` (INTEGER), `notes` (TEXT).
- **API Communication Models:**
    - `CommandPayload`: `{ "action": string, "params": object }` (REST)
    - `TelemetryPayload`: `{ "event": string, "data": object, "progress": number }` (WebSocket)

[Files]
Single sentence describing file modifications.
The project will be structured into a clear separation of concerns: Electron/Frontend, FastAPI Backend, and Shared Assets.

- **New files to be created:**
    - `app/main.py`: FastAPI entry point and route definitions.
    - `app/core/media_engine.py`: FFmpeg wrappers and metadata extraction logic.
    - `app/core/database.py`: SQLite management using SQLAlchemy or direct sqlite3.
    - `app/core/telemetry.py`: WebSocket manager for progress updates.
    - `electron/main.js`: Electron main process (window management, sidecar lifecycle).
    - `electron/preload.js`: Secure bridge between Electron and Frontend.
    - `frontend/index.html`: Main UI entry point (Vanilla HTML).
    - `frontend/styles.css`: Application styling.
    - `frontend/app.js`: Alpine.js logic and API integration.
    - `scripts/setup_env.sh`: Environment setup script.
- **Existing files to be modified:**
    - N/A (Starting from scratch).

[Functions]
Single sentence describing function modifications.
Core functionality is divided between the Python backend for processing and JavaScript/Alpine for UI orchestration.

- **New functions:**
    - `scan_directory(path: str) -> list[ClipMetadata]` (app/core/media_engine.py): Recursively finds video files and extracts technical metadata.
    - `generate_proxy(clip_id: str) -> None` (app/core/media_engine.py): Background task using FFmpeg to create low-res proxies in `.sceneflow/proxies`.
    - `update_clip_status(clip_id: str, status: bool) -> None` (app/core/database.py): Marks a clip as 'kept' or 'discarded'.
    - `create_sequence_from_culling() -> None` (app/core/database.py): Aggregates 'kept' clips into a new sequence.
    - `export_markdown_storyboard(sequence_id: str) -> str` (app/core/exporter.py): Generates the Markdown table for the POC.

[Classes]
Single sentence describing class modifications.
Object-oriented design used for managing long-lived engine components and database sessions.

- **New classes:**
    - `MediaProcessor`: Handles FFmpeg command orchestration and monitoring.
    - `DatabaseManager`: Encapsulates all SQLite CRUD operations.
    - `TelemetryServer`: Manages WebSocket connections and broadcasts event updates to the UI.

[Dependencies]
Single sentence describing dependency modifications.
The project requires Python for backend processing and Node.js/Electron for the desktop environment.

- **Python Packages:** `fastapi`, `uvicorn`, `sqlalchemy`, `python-multipart` (for potential uploads), `ffmpeg-python`.
- **Node.js Packages:** `electron`, `electron-builder`.
- **System Dependencies:** `ffmpeg` must be installed on the host machine.

[Testing]
Single sentence describing testing approach.
Testing will focus on backend processing reliability and API contract adherence.

- **Unit Tests:** Test `MediaProcessor` with sample video files; test `DatabaseManager` for schema integrity.
- **Integration Tests:** Verify the REST/WebSocket flow from a mock client to the FastAPI sidecar.
- **Manual UI Testing:** Validate "Culling" speed and proxy playback smoothness.

[Implementation Order]
Single sentence describing the implementation sequence.
The build will progress from the core data/processing engine outward to the user interface.

1.  **Phase 1: Project Scaffolding:** Initialize Electron and FastAPI project structures; setup `.sceneflow` directory logic.
2.  **Phase 2: Backend Core (Data & Media):** Implement `DatabaseManager` and basic metadata extraction via `MediaProcessor`.
3.  **Phase 3: Communication Layer:** Implement FastAPI REST endpoints and WebSocket telemetry server.
4.  **Phase 4: Frontend Shell:** Create the Electron window and basic Vanilla/Alpine.js UI layout.
5.  **Phase 5: Media Ingestion & Proxying:** Implement folder scanning and background proxy generation with real-time progress updates.
6.  **Phase 6: Culling & Tagging:** Build the UI for marking clips and attaching metadata.
7.  **Phase 7: Storyboarding & Export:** Implement the sequence builder and the Markdown table export functionality.
