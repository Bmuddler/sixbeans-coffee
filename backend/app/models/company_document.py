from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text, ForeignKey
from sqlalchemy.orm import relationship

from app.models import Base


class CompanyDocument(Base):
    __tablename__ = "company_documents"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    category = Column(String(100), nullable=False)  # "Onboarding", "Company Policies", "Training", "Forms", "Other"
    filename = Column(String(255), nullable=False)
    file_data = Column(Text, nullable=False)  # base64 encoded file content
    file_type = Column(String(100), nullable=False)  # MIME type
    file_size = Column(Integer, nullable=False)  # bytes
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    uploader = relationship("User")
