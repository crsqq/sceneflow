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
    resolution = Column(String)
    frame_rate = Column(Float)
    orientation = Column(String)  # 'horizontal' | 'vertical'
    proxy_path = Column(String)
    is_kept = Column(Boolean, default=False)
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
    timestamp = Column(Float, nullable=False)  # Seconds from start
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

    def update_clip_status(self, clip_id: str, is_kept: bool):
        with self.get_session() as session:
            clip = session.query(MediaClip).filter(MediaClip.id == clip_id).first()
            if clip:
                clip.is_kept = is_kept
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
            item = SequenceItem(sequence_id=sequence_id, clip_id=clip_id, position=position, notes=notes)
            session.add(item)
            session.commit()
            session.refresh(item)
            return item

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

    def add_marker(self, clip_id: str, timestamp: float, note: str = None):
        with self.get_session() as session:
            from app.core.database import ClipMarker
            marker = ClipMarker(clip_id=clip_id, timestamp=timestamp, note=note)
            session.add(marker)
            session.commit()
            session.refresh(marker)
            return marker

    def get_markers(self, clip_id: str):
        with self.get_session() as session:
            from app.core.database import ClipMarker
            markers = session.query(ClipMarker).filter(ClipMarker.clip_id == clip_id).all()
            return [{"id": m.id, "timestamp": m.timestamp, "note": m.note} for m in markers]

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
                    "resolution": clip.resolution,
                    "frame_rate": clip.frame_rate,
                    "orientation": clip.orientation,
                    "proxy_path": clip.proxy_path,
                    "is_kept": clip.is_kept,
                    "tags": [{"id": t.id, "tag_type": t.tag_type, "value": t.value} for t in clip.tags]
                }
                results.append(clip_dict)
            return results
