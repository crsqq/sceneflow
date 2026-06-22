# Product Context: SceneFlow

## Problem Statement
Professional video editing workflows often involve a massive gap between raw footage ingestion and the actual creative process in a Non-Linear Editor (NLE) like Premiere Pro or DaVinci Resolve. Organizing, culling, and storyboarding large volumes of high-resolution footage is slow and cumbersome when done directly in an NLE.

## Solution
SceneFlow provides a high-speed, local-first pre-visualization environment. It allows editors to:
1. **Rapidly Ingest:** Scan directories and extract technical metadata instantly.
2. **Smooth Playback:** Automatically generate low-resolution proxies for fluid viewing of 4K/8K footage.
3. **Efficient Culling:** Quickly mark "kept" clips and add creative/technical tags without touching the original source files.
4. **Storyboard:** Arrange selected clips into sequences and export them as a Markdown-based storyboard, ready for the final edit.

## User Experience Goals
- **Speed:** Minimal latency between user actions and visual feedback (via WebSockets).
- **Safety:** Source media must remain strictly read-only. All metadata lives in a "Shadow Database."
- **Simplicity:** A lightweight, web-technology-based UI that feels as responsive as a native desktop application.
