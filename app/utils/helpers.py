"""
Utility helpers shared across the application.

Each function is intentionally narrow in scope — no business logic lives here,
only reusable infrastructure primitives.
"""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path
from typing import List

from app.models.schemas import SourceReference


# ─── Logging ──────────────────────────────────────────────────────────────────


def setup_logger(name: str, level: str = "INFO") -> logging.Logger:
    """
    Return a consistently formatted logger.

    Uses a single StreamHandler so Docker log drivers capture output correctly.
    """
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    return logger


# ─── File Handling ────────────────────────────────────────────────────────────


def sanitize_filename(filename: str) -> str:
    """
    Strip path traversal characters and replace whitespace / special chars
    so the filename is safe to use on any OS.
    """
    # Keep only alphanumerics, dots, underscores, hyphens
    name = Path(filename).name  # drop any directory component
    name = re.sub(r"[^\w.\-]", "_", name)
    return name


def generate_session_id() -> str:
    """Generate a UUID4 string to uniquely identify an upload session."""
    return str(uuid.uuid4())


def ensure_dirs(*paths: str | Path) -> None:
    """Create directories (including parents) if they don't already exist."""
    for p in paths:
        Path(p).mkdir(parents=True, exist_ok=True)


# ─── Source Formatting ────────────────────────────────────────────────────────


def format_sources(documents: list, scores: List[float]) -> List[SourceReference]:
    """
    Convert a list of LangChain Documents + their FAISS scores into
    SourceReference Pydantic models for the API response.

    Args:
        documents: LangChain Document objects with `.page_content` and `.metadata`.
        scores:    Corresponding similarity scores (same length as documents).

    Returns:
        List of SourceReference instances, sorted by score descending.
    """
    sources: List[SourceReference] = []
    for doc, score in zip(documents, scores):
        meta = doc.metadata or {}
        sources.append(
            SourceReference(
                page=meta.get("page", 0),
                chunk_index=meta.get("chunk_index", 0),
                content=doc.page_content.strip(),
                score=round(float(score), 4),
            )
        )
    # Highest similarity first
    return sorted(sources, key=lambda s: s.score, reverse=True)


# ─── Text Utilities ───────────────────────────────────────────────────────────


def truncate_text(text: str, max_chars: int = 300) -> str:
    """Truncate text to max_chars, appending '…' if truncated."""
    return text if len(text) <= max_chars else text[:max_chars].rstrip() + "…"
