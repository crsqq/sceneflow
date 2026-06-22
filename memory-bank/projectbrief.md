# Project Brief: SceneFlow

## Goal
Create a high-speed, local-first pre-visualization environment (SceneFlow) to bridge the gap between raw footage and professional NLE editing.

## Core Requirements
- **Hybrid Architecture:** Electron for desktop shell + FastAPI (Python) sidecar for heavy media processing.
- **Local-First Data:** A "Shadow Database" (SQLite) manages all metadata, tags, and sequences without modifying source media.
- **Automated Proxying:** Uses FFmpeg to generate low-resolution proxies for smooth 4K playback.
- **Communication:** REST API for commands and WebSockets for real-time telemetry/progress updates.
- **Key Features:** 
    - Directory scanning & metadata extraction.
    - Automatic proxy generation.
    - Culling & tagging UI.
    - Storyboarding with Markdown export.

## Target Users
Video editors, cinematographers, and production teams needing a fast way to organize and storyboard footage before moving into heavy NLE workflows.
