"""
Session management API endpoints.

Provides endpoints to inspect, manage, and delete indexed document sessions,
freeing disk storage (uploads, vector DB indices) and in-memory caches.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.utils.helpers import setup_logger

logger = setup_logger(__name__)

router = APIRouter(tags=["Session"])


class DeleteSessionResponse(BaseModel):
    """Response payload for session deletion."""
    session_id: str
    message: str
    deleted: bool


@router.delete(
    "/session/{session_id}",
    response_model=DeleteSessionResponse,
    summary="Delete Session and Free Storage",
    description="Deletes all uploaded PDF files, vector DB FAISS indices, and metadata caches for the specified session.",
)
async def delete_session(session_id: str) -> DeleteSessionResponse:
    """
    Purge session resources:
    1. Removes vector_db/<session_id>/
    2. Removes uploads/<session_id>/
    3. Clears in-memory FAISS store and metadata caches
    """
    from main import app_state  # type: ignore[import]

    retriever = app_state.get("retriever")
    upload_dir = Path(app_state.get("upload_dir", "uploads"))
    vector_db_dir = Path(os.getenv("VECTOR_DB_DIR", "vector_db")) if "os" in globals() else Path("vector_db")

    session_upload_dir = upload_dir / session_id
    session_vector_dir = vector_db_dir / session_id

    existed = False

    # 1. Clean up Vector DB directory and memory cache
    if retriever:
        # In-memory store cache
        if hasattr(retriever, "_vector_store") and hasattr(retriever._vector_store, "_stores"):
            retriever._vector_store._stores.pop(session_id, None)
        # In-memory session meta cache
        if hasattr(retriever, "_session_meta"):
            retriever._session_meta.pop(session_id, None)

    if session_vector_dir.exists():
        try:
            shutil.rmtree(session_vector_dir, ignore_errors=True)
            existed = True
            logger.info("Deleted vector DB directory for session '%s'", session_id)
        except Exception as e:
            logger.warning("Failed to delete vector DB directory for session '%s': %s", session_id, e)

    # 2. Clean up uploads directory
    if session_upload_dir.exists():
        try:
            shutil.rmtree(session_upload_dir, ignore_errors=True)
            existed = True
            logger.info("Deleted uploads directory for session '%s'", session_id)
        except Exception as e:
            logger.warning("Failed to delete uploads directory for session '%s': %s", session_id, e)

    # Reset active session if deleted
    if app_state.get("active_session_id") == session_id:
        app_state["active_session_id"] = None

    if not existed:
        return DeleteSessionResponse(
            session_id=session_id,
            message="Session not found or already deleted.",
            deleted=False,
        )

    return DeleteSessionResponse(
        session_id=session_id,
        message="Session and all associated storage successfully deleted.",
        deleted=True,
    )
