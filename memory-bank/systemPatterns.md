# System Patterns: SceneFlow

## Architecture
SceneFlow uses a **Hybrid Desktop-Web architecture**:
- **Shell:** Electron provides the desktop window management and sidecar lifecycle.
- **Core Engine:** A FastAPI (Python) server runs as a "sidecar" process to handle computationally intensive tasks like media scanning and FFmpeg orchestration.
- **Frontend:** A lightweight web UI built with Vanilla HTML/CSS and Alpine.js for reactive state management, served by Electron.

## Data Management
- **Shadow Database:** A local SQLite database manages all application metadata (media clip details, tags, sequences, etc.). It lives at `<project_root>/.sceneflow/sceneflow.db`, making each project self-contained.
- **Source Integrity:** The system follows a strict "Read-Only" policy for source media. No files are ever written to or modified in the original media directories.
- **Local Storage:** All application state, proxy files, thumbnails, and the SQLite database are managed within the project's `<project_root>/.sceneflow` directory.

## Communication Patterns
- **Command/Control (REST):** The frontend sends HTTP requests to the FastAPI backend for discrete actions (e.g., `/scan`, `/clips/{id}/status`).
- **Telemetry/Observability (WebSockets):** The backend broadcasts real-time events and progress updates via a WebSocket connection to the frontend (e.g., `scan_progress`, `clip_updated`).

## Media Processing
- **Metadata Extraction:** Uses `ffprobe` via the `MediaProcessor` class to extract technical metadata from video files.
- **Proxy Workflow:** FFmpeg is used to generate low-resolution proxies in a dedicated storage location to ensure smooth playback performance.
