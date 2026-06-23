# Progress: SceneFlow

## Completed
- Extract `CreateDate`, `GPSLatitude`, and `GPSLongitude` from clips during scan using `exiftool` only.
- Store extracted metadata plus an editable `short_name` in the shadow database.
- Display recorded datetime and GPS coordinates in the library view.
- Add editable metadata panel (short name, recorded at, latitude, longitude) in the preview.
- Add library sorting by filename, date, and short name (ascending/descending).

## In Progress

## Upcoming

## Known Issues

## Resolved Issues
- Proxy generation no longer spawns unlimited FFmpeg processes; concurrency is bounded (default 3, configurable via `SCENEFLOW_PROXY_CONCURRENCY`).
- UI now shows global preview generation progress (`Previews: X / Y processed`) via a progress bar below the header.
