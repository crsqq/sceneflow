import os
from app.core.database import DatabaseManager

class StoryboardExporter:
    """Generates Markdown-based storyboards from sequences."""
    
    def __init__(self, db_manager: DatabaseManager):
        self.db_manager = db_manager

    def export_markdown_storyboard(self, sequence_id: str) -> str:
        """Generates a Markdown table summarizing the storyboarded sequence.

        Each marker produces its own row. Clips without markers appear once as a
        'full clip' row.
        """
        with self.db_manager.get_session() as session:
            from app.core.database import Sequence, SequenceItem, MediaClip, ClipMarker

            sequence = session.query(Sequence).filter(Sequence.id == sequence_id).first()
            if not sequence:
                return "# Error\nSequence not found."

            md = f"# Storyboard: {sequence.name}\n\n"
            md += f"*Created at: {sequence.created_at.strftime('%Y-%m-%d %H:%M')}*\n\n"
            md += "| Position | File Name | Orientation | Resolution | Section | Note |\n"
            md += "| :--- | :--- | :--- | :--- | :--- | :--- |\n"

            items = session.query(SequenceItem).filter(SequenceItem.sequence_id == sequence_id).order_by(SequenceItem.position).all()

            if not items:
                md += "| - | No clips in sequence | - | - | - | - |\n"
                return md

            def _format_section(start: float, end: float | None) -> str:
                start_str = self._format_time(start)
                if end is not None and end > start:
                    return f"{start_str} – {self._format_time(end)}"
                return start_str

            for item in items:
                clip = session.query(MediaClip).filter(MediaClip.id == item.clip_id).first()
                if not clip:
                    md += f"| {item.position} | [Missing Clip] | - | - | - | - |\n"
                    continue

                markers = (
                    session.query(ClipMarker)
                    .filter(ClipMarker.clip_id == clip.id)
                    .order_by(ClipMarker.timestamp)
                    .all()
                )

                if markers:
                    for marker in markers:
                        section = _format_section(marker.timestamp, marker.end_timestamp)
                        note = marker.note or item.notes or ""
                        md += f"| {item.position} | {clip.file_name} | {clip.orientation or '-'} | {clip.resolution or '-'} | {section} | {note} |\n"
                else:
                    section = "full clip"
                    note = item.notes or ""
                    md += f"| {item.position} | {clip.file_name} | {clip.orientation or '-'} | {clip.resolution or '-'} | {section} | {note} |\n"

            return md

    @staticmethod
    def _format_time(seconds: float) -> str:
        """Format seconds as HH:MM:SS."""
        total = int(round(seconds))
        h, rem = divmod(total, 3600)
        m, s = divmod(rem, 60)
        return f"{h:02d}:{m:02d}:{s:02d}"
