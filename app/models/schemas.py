"""
Pydantic v2 schemas for all API request/response bodies.

Keeping all contracts in one place makes the OpenAPI docs accurate
and prevents subtle type mismatches between layers.
"""

from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field, field_validator


# ─── Upload ───────────────────────────────────────────────────────────────────


class UploadResponse(BaseModel):
    """Returned after a successful PDF ingestion."""

    session_id: str = Field(..., description="Unique session identifier for this document.")
    file_name: str = Field(..., description="Original name of the uploaded file (or comma-separated names).")
    file_names: List[str] = Field(default_factory=list, description="List of all file names in this session.")
    page_count: int = Field(..., description="Total number of pages parsed.")
    chunk_count: int = Field(..., description="Total text chunks stored in FAISS.")
    message: str = Field(default="Document indexed successfully.")


class MultiUploadResponse(BaseModel):
    """Returned after a successful multi-file PDF ingestion."""

    session_id: str = Field(..., description="Unique session identifier for this batch.")
    file_names: List[str] = Field(..., description="Names of all uploaded files.")
    total_files: int = Field(..., description="Number of files uploaded in this batch.")
    page_count: int = Field(..., description="Total pages parsed across all files.")
    chunk_count: int = Field(..., description="Total text chunks stored in FAISS.")
    message: str = Field(default="All documents indexed successfully.")



# ─── Ask ──────────────────────────────────────────────────────────────────────


class AskRequest(BaseModel):
    """Payload for the /ask endpoint."""

    question: str = Field(
        ...,
        min_length=3,
        max_length=1000,
        description="The student's chemistry question.",
    )
    session_id: str = Field(
        ...,
        description="Session ID returned by /upload — ties the question to an indexed document.",
    )
    top_k: Optional[int] = Field(
        default=5,
        ge=1,
        le=20,
        description="Number of chunks to retrieve (overrides server default).",
    )

    @field_validator("question")
    @classmethod
    def question_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Question must not be blank.")
        return v.strip()


class SourceReference(BaseModel):
    """A single retrieved chunk with its provenance metadata."""

    page: int = Field(..., description="1-indexed page number in the original PDF.")
    chunk_index: int = Field(..., description="Position of this chunk within the page.")
    content: str = Field(..., description="The raw text of the retrieved chunk.")
    score: float = Field(..., description="Cosine similarity score (0–1, higher is better).")


class EquationItem(BaseModel):
    """A single chemical equation with a descriptive label."""

    equation: str = Field(..., description="The chemical equation string (e.g. '2H_{2} + O_{2} → 2H_{2}O').")
    label: str = Field(default="", description="Short descriptive label for the equation.")


class AskResponse(BaseModel):
    """Structured response from the /ask endpoint."""

    answer: str = Field(..., description="The generated answer, grounded strictly in context.")
    equations: List[EquationItem] = Field(
        default_factory=list,
        description="Up to 6 key chemical equations/reactions from the answer.",
    )
    sources: List[SourceReference] = Field(
        default_factory=list,
        description="Top-K retrieved chunks with page citations.",
    )
    related_topics: List[str] = Field(
        default_factory=list,
        description="Up to 4 related chemistry topics the student might explore next.",
    )
    session_id: str = Field(..., description="Echo of the request session_id.")


# ─── Health ───────────────────────────────────────────────────────────────────


class IndexStats(BaseModel):
    """FAISS index stats for the active session."""

    session_id: Optional[str] = None
    vector_count: int = 0
    embedding_model: str = ""


class HealthResponse(BaseModel):
    """Application health status."""

    status: str = Field(default="ok")
    app_name: str
    version: str
    gemini_model: str
    embedding_model: str
    index_stats: IndexStats = Field(default_factory=IndexStats)


# ─── Errors ───────────────────────────────────────────────────────────────────


class ErrorResponse(BaseModel):
    """Standard error envelope returned on 4xx/5xx responses."""

    error: str
    detail: Optional[str] = None
    status_code: int
