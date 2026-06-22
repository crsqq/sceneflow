import os
from app.core.database import DatabaseManager

class StoryboardExporter:
    """Generates Markdown-based storyboards from sequences."""
    
    def __init__(self, db_manager: DatabaseManager):
        self.db_manager = db_manager

    def export_markdown_storyboard(self, sequence_id: str) -> str:
        """Generates a Markdown table summarizing the storyboarded sequence."""
        with self.db_manager.get_session() as session:
            from app.core.database import Sequence, SequenceItem, MediaClip
            
            sequence = session.query(Sequence).filter(Sequence.id == sequence_id).first()
            if not sequence:
                return "# Error\nSequence not found."

            md = f"# Storyboard: {sequence.name}\n\n"
            md += f"*Created at: {sequence.created_at.strftime('%Y-%m-%d %H:%M')}*\n\n"
            md += "| Position | File Name | Resolution | Notes |\n"
            md += "| :--- | :--- | :--- | :--- |\n"

            items = session.query(SequenceItem).filter(SequenceItem.sequence_id == sequence_id).order_by(SequenceItem.position).all()
            
            if not items:
                md += "| - | No clips in sequence | - | - |\n"
            else:
                for item in items:
                    clip = session.query(MediaClip).filter(MediaClip.id == item.clip_id).first()
                    if clip:
                        md += f"| {item.position} | {clip.file_name} | {clip.resolution} | {item.notes or ''} |\n"
                    else:
                        md += f"| {item.position} | [Missing Clip] | - | - |\n"

            return md
