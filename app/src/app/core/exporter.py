from app.core.database import DatabaseManager


class StoryboardExporter:
    """Generates Markdown-based storyboards from sequences."""

    def __init__(self, db_manager: DatabaseManager):
        self.db_manager = db_manager

    def export_markdown_storyboard(self, sequence_id: str) -> str:
        """Generates a Markdown table summarizing the storyboarded sequence.

        Each sequence item produces one row. If a marker was selected for the item,
        its section is shown; otherwise the row lists 'full clip'.
        """
        with self.db_manager.get_session() as session:
            from app.core.database import ClipMarker, MediaClip, Sequence, SequenceItem

            sequence = session.query(Sequence).filter(Sequence.id == sequence_id).first()
            if not sequence:
                return "# Error\nSequence not found."

            md = f"# Storyboard: {sequence.name}\n\n"
            md += f"*Created at: {sequence.created_at.strftime('%Y-%m-%d %H:%M')}*\n\n"
            md += "| Position | File Name | Short Name | Orientation | Resolution | Section | Note |\n"
            md += "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n"

            # pylint: disable=duplicate-code
            items = (
                session.query(SequenceItem)
                .filter(SequenceItem.sequence_id == sequence_id)
                .order_by(SequenceItem.position)
                .all()
            )

            if not items:
                md += "| - | No clips in sequence | - | - | - | - |\n"
                return md

            def _format_section(start: float, end: float | None) -> str:
                start_str = self._format_time(start)
                if end is not None and end > start:
                    return f"{start_str} - {self._format_time(end)}"
                return start_str

            for item in items:
                clip = session.query(MediaClip).filter(MediaClip.id == item.clip_id).first()
                if not clip:
                    md += f"| {item.position} | [Missing Clip] | | - | - | - | - |\n"
                    continue

                short_name = clip.short_name or ""
                if item.marker_id:
                    marker = session.query(ClipMarker).filter(ClipMarker.id == item.marker_id).first()
                    section = _format_section(marker.timestamp, marker.end_timestamp) if marker else "full clip"
                    note = (marker.note if marker else None) or item.notes or ""
                else:
                    section = "full clip"
                    note = item.notes or ""
                md += (
                    f"| {item.position} | {clip.file_name} | {short_name} "
                    f"| {clip.orientation or '-'} | {clip.resolution or '-'} "
                    f"| {section} | {note} |\n"
                )

            return md

    @staticmethod
    def _format_time(seconds: float) -> str:
        """Format seconds as HH:MM:SS."""
        total = int(seconds)
        h, rem = divmod(total, 3600)
        m, s = divmod(rem, 60)
        return f"{h:02d}:{m:02d}:{s:02d}"
