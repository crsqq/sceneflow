# SceneFlow

SceneFlow is an MVP for managing scene flows. It uses a FastAPI backend and an Electron-based frontend.

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
uv run uvicorn main:app --reload
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

## Project Structure

- `app/`: FastAPI backend service.
- `electron/`: Electron main process logic.
- `frontend/`: Web frontend assets (HTML, CSS, JS).
- `memory-bank/`: Project documentation and context.
- `scripts/`: Helper scripts for environment setup.
