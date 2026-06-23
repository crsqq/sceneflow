from sqlalchemy import create_engine, Column, String, Float, Boolean, ForeignKey, DateTime, Integer
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
import uuid
from datetime import datetime

Base = declarative_base()

class MediaClip(Base):
    __tablename__ = 'media_clips'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    file_path = Column(String, unique=True, nullable=False)
    file_name = Column(String, nullable=False)
    short_name = Column(String, nullable=True)
    resolution = Column(String)
    frame_rate = Column(Float)
    orientation = Column(String)  # 'horizontal' | 'vertical'
    recorded_at = Column(DateTime, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    proxy_path = Column(String)
    thumbnail_path = Column(String)
    is_kept = Column(Boolean, default=False)
    is_rejected = Column(Boolean, default=False)
    tags = relationship("Tag", back_populates="clip", cascade="all, delete-orphan")

class Tag(Base):
    __tablename__ = 'tags'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    clip_id = Column(String, ForeignKey('media_clips.id'))
    tag_type = Column(String)  # 'technical' | 'creative'
    value = Column(String)
    clip = relationship("MediaClip", back_populates="tags")

class ClipMarker(Base):
    __tablename__ = 'clip_markers'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    clip_id = Column(String, ForeignKey('media_clips.id'))
    timestamp = Column(Float, nullable=False)  # Section start in seconds
    end_timestamp = Column(Float, nullable=True)  # Section end in seconds (optional)
    note = Column(String)

class Sequence(Base):
    __tablename__ = 'sequences'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

class SequenceItem(Base):
    __tablename__ = 'sequence_items'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    sequence_id = Column(String, ForeignKey('sequences.id'))
    clip_id = Column(String, ForeignKey('media_clips.id'))
    position = Column(Integer)
    notes = Column(String)

import os
from sqlalchemy.orm import Session

class DatabaseManager:
    """Encapsulates all SQLite CRUD operations."""
    def __init__(self, db_url: str = "sqlite:///./sceneflow.db"):
        self.engine = create_engine(db_url, connect_args={"check_same_thread": False})
        self.SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    @classmethod
    def for_project_dir(cls, project_dir: str) -> "DatabaseManager":
        """Create a DatabaseManager whose database lives in <project_dir>/.sceneflow/sceneflow.db."""
        sceneflow_dir = os.path.join(project_dir, ".sceneflow")
        os.makedirs(sceneflow_dir, exist_ok=True)
        db_path = os.path.join(sceneflow_dir, "sceneflow.db")
        return cls(db_url=f"sqlite:///{db_path}")

    def init_db(self):
        """Create all tables."""
        Base.metadata.create_all(bind=self.engine)

    def get_session(self) -> Session:
        """Returns a new session."""
        return self.SessionFactory()

    def add_clip(self, clip: MediaClip):
        with self.get_session() as session:
            session.add(clip)
            session.commit()
            session.refresh(clip)
            return clip

    def get_all_clips(self):
        with self.get_session() as session:
            return session.query(MediaClip).all()

    def update_clip_status(self, clip_id: str, is_kept: bool | None = None, is_rejected: bool | None = None):
        with self.get_session() as session:
            clip = session.query(MediaClip).filter(MediaClip.id == clip_id).first()
            if clip:
                if is_kept is not None:
                    clip.is_kept = is_kept
                if is_rejected is not None:
                    clip.is_rejected = is_rejected
                session.commit()

    def update_clip_metadata(self, clip_id: str, short_name: str | None = None, recorded_at: datetime | None = None, latitude: float | None = None, longitude: float | None = None):
        with self.get_session() as session:
            clip = session.query(MediaClip).filter(MediaClip.id == clip_id).first()
            if clip:
                if short_name is not None:
                    clip.short_name = short_name
                if recorded_at is not None:
                    clip.recorded_at = recorded_at
                if latitude is not None:
                    clip.latitude = latitude
                if longitude is not None:
                    clip.longitude = longitude
                session.commit()

    def create_sequence(self, name: str) -> Sequence:
        with self.get_session() as session:
            sequence = Sequence(name=name)
            session.add(sequence)
            session.commit()
            session.refresh(sequence)
            return sequence

    def add_sequence_item(self, sequence_id: str, clip_id: str, position: int, notes: str = None) -> SequenceItem:
        with self.get_session() as session:
            # Shift existing items at or after the target position to make room
            existing_items = session.query(SequenceItem).filter(
                SequenceItem.sequence_id == sequence_id,
                SequenceItem.position >= position
            ).order_by(SequenceItem.position.desc()).all()
            for existing in existing_items:
                existing.position += 1
            item = SequenceItem(sequence_id=sequence_id, clip_id=clip_id, position=position, notes=notes)
            session.add(item)
            session.commit()
            session.refresh(item)
            return item

    def remove_sequence_item(self, item_id: str):
        with self.get_session() as session:
            item = session.query(SequenceItem).filter(SequenceItem.id == item_id).first()
            if item:
                sequence_id = item.sequence_id
                position = item.position
                session.delete(item)
                # Compact positions after removal
                remaining = session.query(SequenceItem).filter(
                    SequenceItem.sequence_id == sequence_id,
                    SequenceItem.position > position
                ).order_by(SequenceItem.position).all()
                for idx, remaining_item in enumerate(remaining):
                    remaining_item.position = position + idx
                session.commit()

    def reorder_sequence_items(self, sequence_id: str, item_ids: list[str]):
        with self.get_session() as session:
            items = session.query(SequenceItem).filter(SequenceItem.sequence_id == sequence_id).all()
            item_map = {item.id: item for item in items}
            for new_position, item_id in enumerate(item_ids):
                if item_id in item_map:
                    item_map[item_id].position = new_position
            session.commit()

    def get_sequence_items_with_clips(self, sequence_id: str):
        with self.get_session() as session:
            items = (
                session.query(SequenceItem)
                .filter(SequenceItem.sequence_id == sequence_id)
                .order_by(SequenceItem.position)
                .all()
            )
            results = []
            for item in items:
                clip = session.query(MediaClip).filter(MediaClip.id == item.clip_id).first()
                results.append({
                    "id": item.id,
                    "sequence_id": item.sequence_id,
                    "clip_id": item.clip_id,
                    "position": item.position,
                    "notes": item.notes,
                    "clip": {
                        "id": clip.id,
                        "file_path": clip.file_path,
                        "file_name": clip.file_name,
                        "short_name": clip.short_name,
                        "resolution": clip.resolution,
                        "frame_rate": clip.frame_rate,
                        "orientation": clip.orientation,
                        "recorded_at": clip.recorded_at.isoformat() if clip.recorded_at else None,
                        "latitude": clip.latitude,
                        "longitude": clip.longitude,
                        "proxy_path": clip.proxy_path,
                        "thumbnail_path": clip.thumbnail_path,
                        "is_kept": clip.is_kept,
                        "is_rejected": clip.is_rejected,
                        "tags": [{"id": t.id, "tag_type": t.tag_type, "value": t.value} for t in clip.tags]
                    } if clip else None
                })
            return results

    def add_tag(self, clip_id: str, tag_type: str, value: str):
        with self.get_session() as session:
            tag = Tag(clip_id=clip_id, tag_type=tag_type, value=value)
            session.add(tag)
            session.commit()
            return tag

    def remove_tag(self, tag_id: str):
        with self.get_session() as session:
            tag = session.query(Tag).filter(Tag.id == tag_id).first()
            if tag:
                session.delete(tag)
                session.commit()

    def add_marker(self, clip_id: str, timestamp: float, end_timestamp: float = None, note: str = None):
        with self.get_session() as session:
            from app.core.database import ClipMarker
            marker = ClipMarker(clip_id=clip_id, timestamp=timestamp, end_timestamp=end_timestamp, note=note)
            session.add(marker)
            session.commit()
            session.refresh(marker)
            return marker

    def get_markers(self, clip_id: str):
        with self.get_session() as session:
            from app.core.database import ClipMarker
            markers = session.query(ClipMarker).filter(ClipMarker.clip_id == clip_id).all()
            return [{"id": m.id, "timestamp": m.timestamp, "end_timestamp": m.end_timestamp, "note": m.note} for m in markers]

    def remove_marker(self, marker_id: str):
        with self.get_session() as session:
            from app.core.database import ClipMarker
            marker = session.query(ClipMarker).filter(ClipMarker.id == marker_id).first()
            if marker:
                session.delete(marker)
                session.commit()

    def get_all_clips_with_tags(self):
        """Returns all clips with their associated tags."""
        with self.get_session() as session:
            clips = session.query(MediaClip).all()
            results = []
            for clip in clips:
                clip_dict = {
                    "id": clip.id,
                    "file_path": clip.file_path,
                    "file_name": clip.file_name,
                    "short_name": clip.short_name,
                    "resolution": clip.resolution,
                    "frame_rate": clip.frame_rate,
                    "orientation": clip.orientation,
                    "recorded_at": clip.recorded_at.isoformat() if clip.recorded_at else None,
                    "latitude": clip.latitude,
                    "longitude": clip.longitude,
                    "proxy_path": clip.proxy_path,
                    "thumbnail_path": clip.thumbnail_path,
                    "is_kept": clip.is_kept,
                    "is_rejected": clip.is_rejected,
                    "tags": [{"id": t.id, "tag_type": t.tag_type, "value": t.value} for t in clip.tags]
                }
                results.append(clip_dict)
            return results
