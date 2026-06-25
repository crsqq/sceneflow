# SceneFlow

## What it's for

You come back from a shoot with hundreds of clips. Before you touch an NLE, you need to answer two questions: which clips are worth keeping, and what order do they go in? Doing that inside Premiere or Resolve means importing everything, waiting for proxies, and fighting a tool built for editing rather than selecting.

SceneFlow handles only this pre-edit phase. Point it at a folder, it scans and builds low-res proxies in the background, and you get a fast keyboard-driven interface for culling (keep/reject), tagging shot types, and assembling a rough sequence — the blueprint. When you're done, you export a Markdown storyboard that describes exactly what to pull into the NLE and in what order.

The source files are never touched. Everything SceneFlow generates — proxies, thumbnails, the database — goes into a `.sceneflow/` folder next to your footage.

## Prerequisites

Before running the project, ensure you have the following installed:

- [Python 3.13+](https://www.python.org/)
- [uv](https://github.com/astral-sh/uv) (Python package and project manager)
- [Node.js & npm](https://nodejs.org/)

## Quick Start

The easiest way to set up the entire environment is by running the provided setup script:

```bash
chmod +x scripts/setup_env.sh
./scripts/setup_env.sh
```

## Manual Setup

### 1. Backend (Python)

The backend is located in the `app/` directory and uses `uv`.

```bash
cd app
uv sync
```

To start the backend server:

```bash
uv run uvicorn app.main:app --reload --app-dir src
```

### 2. Frontend (Electron)

The frontend shell is managed via `npm` at the root level.

```bash
npm install
```

To start the Electron application:

```bash
npm start
```

## Running the App

The simplest way to start the full application is via the Makefile:

```bash
make run
```

This kills any existing backend process, starts the Electron shell, and Electron automatically spawns the Python sidecar.

Alternatively, you can start the backend and frontend separately (see Quick Start and Manual Setup above).

## Project Structure

- `app/`: FastAPI backend service.
- `electron/`: Electron main process logic.
- `frontend/`: Web frontend assets (HTML, CSS, JS).
- `memory-bank/`: Project documentation and context.
- `scripts/`: Helper scripts for environment setup.

## Shot Tags

Tags categorise clips during culling and storyboard assembly.

| Tag | Purpose |
|---|---|
| **Wide** | Wide-angle shot showing the full environment. Used to establish geography, show scale, or give breathing room between tight shots. |
| **Slow-Mo** | High frame rate footage played back slower. Requires speed adjustment in the NLE; used for emphasis or emotional impact. |
| **Close-Up** | Tight framing on a detail — face, hands, texture, object. The building block of emotional storytelling; intercut with wides for rhythm. |
| **Cutaway** | Cuts away from the main subject to something in the scene — a reaction, a detail, an environmental element. Used to cover edits or add context. |
| **Drone** | Aerial footage. Used for establishing geography, scene transitions, or cinematic opening/closing shots. |
| **Establishing** | Orients the viewer to a new location or time. Typically placed at the top of a scene to answer "where are we?" before cutting to tighter coverage. |
| **Motion** | Shot defined by camera movement — gimbal push-in, slider, tracking, pan, orbit. Flag these to pace sequences by alternating moving and locked-off shots. |
| **Static** | Locked-off, tripod shot with no camera movement. The natural counterpart to Motion; use to break up pans and give the eye a rest. |

## Example Storyboard — Nature Short

A typical arc for a cinematic landscape film with no narration or interview.

| Position | Tag(s) | Description |
|---|---|---|
| 1 | Drone + Establishing | Aerial reveal — wide pull-back over the landscape to open on location and scale |
| 2 | Wide | Ground-level locked-off wide; let the environment breathe |
| 3 | Motion | Slow gimbal push toward a focal point — river bend, mountain ridge, treeline |
| 4 | Close-Up | Texture detail — water over rocks, frost on leaves, bark, soil |
| 5 | Slow-Mo | Motion in the environment — waves, wind through grass, bird in flight |
| 6 | Drone | Transitional aerial move to the next location or time of day |
| 7 | Establishing | Ground-level reorientation at the new location |
| 8 | Wide | Wider coverage of the new scene |
| 9 | Close-Up | Detail at the new location |
| 10 | Motion | Camera movement building toward the emotional peak |
| 11 | Slow-Mo | The centrepiece shot — golden hour light, waterfall, wildlife moment |
| 12 | Drone | Slow climb-out or pull-back to close; returns the viewer to scale |

Tags can be combined on a single clip (e.g. a Drone shot that is also Slow-Mo). Use the query filter to pull specific subsets during culling: `tags IN ("Drone") AND is_kept = true`.
