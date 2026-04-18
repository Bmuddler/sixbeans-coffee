from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Text
from sqlalchemy.orm import relationship

from app.models import Base


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)
    content = Column(Text, nullable=False)
    is_announcement = Column(Boolean, default=False, nullable=False)
    is_direct = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    sender = relationship("User", back_populates="sent_messages")
    location = relationship("Location", back_populates="messages")
    recipients = relationship("MessageRecipient", back_populates="message", cascade="all, delete-orphan")


class MessageRecipient(Base):
    __tablename__ = "message_recipients"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    read_at = Column(DateTime, nullable=True)

    message = relationship("Message", back_populates="recipients")
    user = relationship("User")
