# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

SceneFlow is a video pre-visualization tool — it ingests raw footage, builds low-res proxies, and lets users cull/tag/sequence clips into a storyboard for NLE handoff. Architecture: Electron desktop shell + FastAPI Python sidecar + Alpine.js frontend.

## Development Commands

**Backend (Python, run from `app/`):**
```sh
uv sync                                                        # install deps
uv run uvicorn app.main:app --reload --app-dir src             # run dev server (port 8000)
make lint                                                     # lint Python code with pylint
make ruff-check                                               # check Python code with ruff
make ruff-fix                                                 # auto-fix Python code with ruff
```

**Frontend / Electron (run from repo root):**
```sh
npm install    # install deps
npm start      # start Electron (it spawns the Python sidecar automatically)
npm run build  # package with electron-builder
```

**One-shot setup:**
```sh
./scripts/setup_env.sh
```

There are no automated tests configured yet.

## Architecture

```
Electron (electron/main.js)
  ├── Spawns Python sidecar (uvicorn) on startup
  ├── Opens BrowserWindow → frontend/index.html
  └── preload.js: context isolation bridge for file dialogs

Frontend (frontend/app.js — Alpine.js)
  ├── REST calls → FastAPI http://127.0.0.1:8000
  └── WebSocket → ws://127.0.0.1:8765 (telemetry/progress events)

Backend (app/src/app/)
  ├── main.py          — all FastAPI routes
  ├── core/database.py — SQLAlchemy ORM + DatabaseManager CRUD (SQLite)
  ├── core/media_engine.py — FFmpeg/ffprobe/exiftool orchestration, proxy generation
  ├── core/query_parser.py — JQL-like filter parser (AST → SQLAlchemy)
  ├── core/exporter.py — Markdown storyboard export
  └── core/telemetry.py — WebSocket server broadcasting progress events
```

## Key Design Decisions

**Shadow database:** All metadata and generated assets live in `<project_root>/.sceneflow/` — source media is never modified. The DB file is `.sceneflow/sceneflow.db`; proxies/thumbs go in `.sceneflow/proxies/` and `.sceneflow/thumbs/`.

**Bounded proxy concurrency:** `MediaProcessor` uses `asyncio.Semaphore` defaulting to 3 concurrent FFmpeg jobs. Override with `SCENEFLOW_PROXY_CONCURRENCY` env var.

**Telemetry events:** The WebSocket server (`core/telemetry.py`, port 8765) broadcasts `scan_progress`, `proxy_queue_progress`, `clip_updated`, and `sequence_updated`. Frontend subscribes on load and uses these to drive progress UI — don't remove or rename event types without updating `app.js`.

**Query language:** `core/query_parser.py` parses JQL-like expressions (`tags IN ("Drone") AND is_kept = true`) into an AST applied to SQLAlchemy queries. Supported fields: `orientation`, `resolution`, `frame_rate`, `is_kept`, `is_rejected`, `tags`, `recorded_at`, `latitude`, `longitude`, `file_name`, `short_name`.

## Database Schema

| Table | Key columns |
|---|---|
| `media_clips` | `id` (UUID), `file_path` (unique), `short_name`, `resolution`, `frame_rate`, `orientation`, `recorded_at`, `lat/lon`, `proxy_path`, `thumbnail_path`, `is_kept`, `is_rejected` |
| `tags` | `clip_id` (FK), `tag_type` ('technical' \| 'creative'), `value` |
| `clip_markers` | `clip_id` (FK), `timestamp`, `end_timestamp`, `note` |
| `sequences` | `id`, `name`, `created_at` |
| `sequence_items` | `sequence_id` (FK), `clip_id` (FK), `position`, `notes` |

## Known Issues

- Sequence/blueprint builder has bugs with more than 2 clips
- No UI shortcut to add a clip directly to the blueprint (drag-drop only)
- Short names are not displayed in the blueprint view
