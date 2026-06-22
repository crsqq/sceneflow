# Progress: SceneFlow

## Completed
- [x] Phase 1: Project Scaffolding (Electron + FastAPI structures)
- [x] Phase 2: Backend Core (Database schema, Media Engine with proxy logic, Telemetry)
- [x] Phase 3: Communication Layer (FastAPI REST endpoints & WebSocket server)
- [x] Phase 4: Frontend Shell (Vanilla HTML/CSS + Alpine.js)
- [x] Phase 5: Media Ingestion & Proxying (Scanning, proxy generation, real-time UI feedback)
- [x] Phase 6: Culling & Tagging UI (Marking clips and attaching/removing tags)
- [x] Phase 7: Storyboarding & Markdown Export (Backend implementation of sequences and MD export)
- [x] Initialize Memory Bank
- [x] Marker ranges with two-click start/end workflow
- [x] Unified Markdown storyboard table with Orientation and one row per marker
- [x] Preview video sizing constrained to natural resolution
- [x] Optimistic Keep button toggle in clip list
- [x] Single-point "Add Marker" button
- [x] Improved marker note modal dialog
- [x] Preview Markdown button and modal for sequences

## In Progress
- [ ] End-to-end testing of the updated marker and storyboard workflow.

## Upcoming
- [ ] Refinement of UI/UX across all modules.
- [ ] Add automated tests for marker ranges and exporter output.

## Known Issues
- Existing SQLite databases will need schema migration (or deletion) because `clip_markers` gained an `end_timestamp` column.
