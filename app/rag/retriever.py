"""
Context retriever — orchestrates the full RAG ingestion and retrieval pipeline.

This class is the single entry-point used by the API layer; it wires together
the parser, chunker, embedding service, and vector store.
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Tuple

from langchain.schema import Document

from app.rag.parser import PDFParser
from app.rag.chunker import DocumentChunker
from app.rag.embeddings import EmbeddingService
from app.rag.vector_store import VectorStoreManager
from app.utils.helpers import setup_logger

logger = setup_logger(__name__)


class ContextRetriever:
    """
    Orchestrates:
    1. PDF parsing  (PDFParser)
    2. Chunking     (DocumentChunker)
    3. Embedding    (EmbeddingService)
    4. Indexing     (VectorStoreManager.build)
    5. Retrieval    (VectorStoreManager.search)

    The API layer only ever calls:
        - retriever.ingest(pdf_path, session_id)   → during /upload
        - retriever.retrieve(question, session_id) → during /ask
    """

    def __init__(
        self,
        chunk_size: int = 700,
        chunk_overlap: int = 100,
        top_k: int = 5,
        vector_db_dir: str = "vector_db",
        embedding_model: str = "BAAI/bge-base-en-v1.5",
    ) -> None:
        self._chunk_size = chunk_size
        self._chunk_overlap = chunk_overlap
        self._top_k = top_k

        self._parser = PDFParser()
        self._embedding_service = EmbeddingService.get_instance(model_name=embedding_model)
        self._vector_store = VectorStoreManager(
            vector_db_dir=vector_db_dir,
            embedding_service=self._embedding_service,
        )

        # Per-session metadata cache: session_id → {page_count, chunk_count, ...}
        self._session_meta: dict[str, dict] = {}

    # ── Ingestion pipeline ────────────────────────────────────────────────────

    def ingest(self, pdf_path: str | Path, session_id: str) -> dict:
        """
        Parse the PDF, chunk it, embed chunks, and build the FAISS index.

        Args:
            pdf_path:   Path to the uploaded PDF file.
            session_id: Unique identifier for this upload session.

        Returns:
            Dict with keys: page_count, chunk_count, session_id.
        """
        pdf_path = Path(pdf_path)
        logger.info(
            "Starting ingestion for session '%s', file '%s'.",
            session_id,
            pdf_path.name,
        )

        # 1 — Parse
        pages = self._parser.parse(pdf_path)

        # 2 — Chunk (pass filename for metadata)
        chunker = DocumentChunker(
            chunk_size=self._chunk_size,
            chunk_overlap=self._chunk_overlap,
            source_file=pdf_path.name,
        )
        chunks: List[Document] = chunker.chunk(pages)

        # 3+4 — Embed and index
        vector_count = self._vector_store.build(
            documents=chunks,
            session_id=session_id,
        )

        meta = {
            "session_id": session_id,
            "page_count": len(pages),
            "chunk_count": vector_count,
        }
        self._session_meta[session_id] = meta

        logger.info(
            "Ingestion complete for session '%s'. Pages: %d, Chunks: %d.",
            session_id,
            len(pages),
            vector_count,
        )
        return meta

    # ── Retrieval ─────────────────────────────────────────────────────────────

    def retrieve(
        self,
        question: str,
        session_id: str,
        k: int | None = None,
    ) -> Tuple[List[Document], List[float]]:
        """
        Retrieve the top-K most relevant chunks for a question.

        Args:
            question:   The student's question.
            session_id: Must match a previously ingested session.
            k:          Override the default top_k if provided.

        Returns:
            Tuple of (documents, scores) ready for the prompt builder.
        """
        effective_k = k if k is not None else self._top_k
        logger.info(
            "Retrieving top-%d chunks for session '%s'.", effective_k, session_id
        )

        documents, scores = self._vector_store.search(
            query=question,
            session_id=session_id,
            k=effective_k,
        )

        logger.info("Retrieved %d chunks.", len(documents))
        return documents, scores

    # ── Introspection ─────────────────────────────────────────────────────────

    def session_exists(self, session_id: str) -> bool:
        """Return True if a FAISS index has been built for this session."""
        return self._vector_store.exists(session_id)

    def get_session_meta(self, session_id: str) -> dict:
        """Return cached metadata for a session, or empty dict if not found."""
        return self._session_meta.get(session_id, {})
