# Active Context: SceneFlow

## Current Focus
- Creative workflow UX: keyboard-driven culling, preset tagging, drag-and-drop Blueprint sequencing, and cinematic dark UI.
- Bridging the gap between raw footage review and sequence assembly without touching source media.

## Recent Changes
- Added three-state culling model (`is_kept` / `is_rejected`) to the backend and UI.
- Added thumbnail generation alongside proxy generation.
- Added scan progress telemetry (`scan_started`, `scan_progress`, `scan_complete`).
- Added sequence item management endpoints: list, remove, reorder.
- Implemented Electron native folder picker via `dialog.showOpenDialog`.
- Rewrote frontend with:
    - Dark cinematic theme.
    - Keyboard shortcuts for playback (J/K/L shuttle, arrows, space), culling (K/X/U), and tagging (1–9).
    - Preset creative tag palette.
    - Cull and tag filters.
    - Drag-and-drop Blueprint sequence builder.
    - Toast notifications and shortcut help modal.

## Next Steps
1. Run end-to-end test: scan a folder, cull with keyboard, tag with palette, build a Blueprint, export Markdown.
2. Add automated tests for cull state, tag palette, and sequence reordering.
3. Consider persisting user preferences (tag palette, auto-advance, focus mode) in localStorage.
4. Evaluate thumbnail extraction performance on large directories.
