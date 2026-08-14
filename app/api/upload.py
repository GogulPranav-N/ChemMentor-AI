"""
POST /upload — PDF ingestion endpoint (single file).
POST /upload-multi — PDF ingestion endpoint (multiple files in one request).

Accepts chemistry PDFs, validates them, saves to disk, then runs
the full RAG ingestion pipeline (parse → chunk → embed → FAISS index).
Returns a session_id the client must include in all subsequent /ask calls.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from typing import List, Optional
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.models.schemas import MultiUploadResponse, UploadResponse
from app.utils.helpers import (
    generate_session_id,
    sanitize_filename,
    setup_logger,
)

logger = setup_logger(__name__)

router = APIRouter(tags=["Upload"])

_ALLOWED_CONTENT_TYPES = {"application/pdf", "application/x-pdf"}
_MAX_FILE_SIZE_MB = 50
_MAX_FILE_SIZE_BYTES = _MAX_FILE_SIZE_MB * 1024 * 1024


@router.post(
    "/upload",
    response_model=UploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload Chemistry PDF",
    description=(
        "Upload a chemistry PDF. The server parses, chunks, embeds, and indexes the content "
        "into FAISS. Returns a `session_id` required for all `/ask` requests."
    ),
)
async def upload_pdf(
    file: UploadFile = File(..., description="Chemistry PDF file to index."),
    session_id: Optional[str] = Form(None, description="Existing session ID to append this PDF to."),
) -> UploadResponse:
    """
    Full ingestion pipeline in one request:
    1. Validate file type and size.
    2. Save to uploads/ with a sanitized filename.
    3. Run parse → chunk → embed → FAISS index.
    4. Return session metadata.
    """
    from main import app_state  # type: ignore[import]

    # ── Validation ────────────────────────────────────────────────────────────

    if file.content_type not in _ALLOWED_CONTENT_TYPES and not (
        file.filename or ""
    ).lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only PDF files are accepted. Please upload a .pdf file.",
        )

    # Read file content for size check
    content = await file.read()
    if len(content) > _MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum allowed size of {_MAX_FILE_SIZE_MB} MB.",
        )

    # ── Persist ───────────────────────────────────────────────────────────────

    session_id = session_id or generate_session_id()
    safe_name = sanitize_filename(file.filename or "document.pdf")
    upload_dir = Path(app_state.get("upload_dir", "uploads"))
    upload_dir.mkdir(parents=True, exist_ok=True)

    # Store each upload in its own subdirectory to avoid collisions
    session_upload_dir = upload_dir / session_id
    session_upload_dir.mkdir(parents=True, exist_ok=True)
    save_path = session_upload_dir / safe_name

    with open(save_path, "wb") as f:
        f.write(content)

    logger.info(
        "PDF saved. session_id=%s, file=%s, size=%d bytes.",
        session_id,
        safe_name,
        len(content),
    )

    # ── Ingest ────────────────────────────────────────────────────────────────

    retriever = app_state.get("retriever")
    if retriever is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG pipeline is not yet initialised. Please try again shortly.",
        )

    try:
        meta = retriever.ingest(pdf_path=save_path, session_id=session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to process PDF: {exc}",
        )
    except Exception as exc:
        logger.exception("Unexpected error during ingestion.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred during PDF processing.",
        )

    # Track most recently uploaded session for health endpoint
    app_state["active_session_id"] = session_id

    return UploadResponse(
        session_id=session_id,
        file_name=meta.get("file_name", safe_name),
        file_names=meta.get("file_names", [safe_name]),
        page_count=meta["page_count"],
        chunk_count=meta["chunk_count"],
        message="Document indexed successfully. You can now ask questions.",
    )


@router.post(
    "/upload-multi",
    response_model=MultiUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload Multiple Chemistry PDFs",
    description=(
        "Upload multiple chemistry PDFs at once. All files are indexed into the same "
        "session for cross-file search. Returns aggregate metadata."
    ),
)
async def upload_multiple_pdfs(
    files: List[UploadFile] = File(..., description="Chemistry PDF files to index."),
    session_id: Optional[str] = Form(None, description="Existing session ID to append files to."),
) -> MultiUploadResponse:
    """
    Batch ingestion pipeline:
    1. Validate each file.
    2. Save all files to uploads/<session_id>/.
    3. Sequentially ingest each file.
    4. Return aggregate session metadata.
    """
    from main import app_state  # type: ignore[import]

    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files provided.",
        )

    retriever = app_state.get("retriever")
    if retriever is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG pipeline is not yet initialised. Please try again shortly.",
        )

    session_id = session_id or generate_session_id()
    upload_dir = Path(app_state.get("upload_dir", "uploads"))
    session_upload_dir = upload_dir / session_id
    session_upload_dir.mkdir(parents=True, exist_ok=True)

    all_file_names: List[str] = []
    meta = {}

    for idx, file in enumerate(files):
        # ── Validate ──────────────────────────────────────────────────────
        if file.content_type not in _ALLOWED_CONTENT_TYPES and not (
            file.filename or ""
        ).lower().endswith(".pdf"):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"File '{file.filename}' is not a PDF. Only PDF files are accepted.",
            )

        content = await file.read()
        if len(content) > _MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File '{file.filename}' exceeds maximum allowed size of {_MAX_FILE_SIZE_MB} MB.",
            )

        # ── Persist ───────────────────────────────────────────────────────
        safe_name = sanitize_filename(file.filename or f"document_{idx + 1}.pdf")
        save_path = session_upload_dir / safe_name

        with open(save_path, "wb") as f:
            f.write(content)

        logger.info(
            "PDF saved (%d/%d). session_id=%s, file=%s, size=%d bytes.",
            idx + 1,
            len(files),
            session_id,
            safe_name,
            len(content),
        )

        # ── Ingest ────────────────────────────────────────────────────────
        try:
            meta = retriever.ingest(pdf_path=save_path, session_id=session_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Failed to process '{safe_name}': {exc}",
            )
        except Exception as exc:
            logger.exception("Unexpected error during ingestion of '%s'.", safe_name)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"An unexpected error occurred while processing '{safe_name}'.",
            )

        all_file_names.append(safe_name)

    # Track most recently uploaded session for health endpoint
    app_state["active_session_id"] = session_id

    return MultiUploadResponse(
        session_id=session_id,
        file_names=meta.get("file_names", all_file_names),
        total_files=len(all_file_names),
        page_count=meta.get("page_count", 0),
        chunk_count=meta.get("chunk_count", 0),
        message=f"All {len(all_file_names)} documents indexed successfully. You can now ask questions.",
    )
