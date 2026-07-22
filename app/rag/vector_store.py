"""
FAISS vector store manager.

Handles building, persisting, loading, and searching the FAISS index.
Each upload session gets its own index file so multiple documents can
be indexed independently.
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Tuple

from langchain.schema import Document
from langchain_community.vectorstores import FAISS

from app.rag.embeddings import EmbeddingService
from app.utils.helpers import setup_logger

logger = setup_logger(__name__)

# FAISS index is stored as two files: <session_id>.faiss and <session_id>.pkl
_INDEX_SUFFIX = ".faiss"
_PKL_SUFFIX = ".pkl"


class VectorStoreManager:
    """
    Manages per-session FAISS vector indices.

    Each upload session creates a new FAISS index written to disk under
    `vector_db/<session_id>/`. This allows the application to serve
    multiple indexed documents simultaneously and survive restarts.

    Public interface:
        build(documents, session_id)  → builds & persists the index
        load(session_id)              → loads a previously built index
        search(query, k, session_id)  → similarity search, returns (docs, scores)
        exists(session_id)            → True if an index for this session exists
    """

    def __init__(
        self,
        vector_db_dir: str = "vector_db",
        embedding_service: EmbeddingService | None = None,
    ) -> None:
        self._db_dir = Path(vector_db_dir)
        self._db_dir.mkdir(parents=True, exist_ok=True)
        self._embedding_service = embedding_service or EmbeddingService.get_instance()
        # Cache of loaded FAISS stores keyed by session_id
        self._stores: dict[str, FAISS] = {}

    # ── Build ─────────────────────────────────────────────────────────────────

    def build(self, documents: List[Document], session_id: str) -> int:
        """
        Create a FAISS index from a list of Documents and persist it to disk.

        Args:
            documents:  Chunked LangChain Documents with metadata.
            session_id: Unique identifier for this upload session.

        Returns:
            Number of vectors stored in the index.
        """
        if not documents:
            raise ValueError("Cannot build a FAISS index with zero documents.")

        logger.info(
            "Building FAISS index for session '%s' with %d chunks.",
            session_id,
            len(documents),
        )

        store = FAISS.from_documents(
            documents=documents,
            embedding=self._embedding_service.embeddings,
        )

        # Persist to <vector_db_dir>/<session_id>/
        save_path = self._session_path(session_id)
        save_path.mkdir(parents=True, exist_ok=True)
        store.save_local(str(save_path))

        # Cache for immediate use
        self._stores[session_id] = store

        vector_count = store.index.ntotal
        logger.info(
            "FAISS index saved to '%s'. Vectors stored: %d.",
            save_path,
            vector_count,
        )
        return vector_count

    # ── Load ──────────────────────────────────────────────────────────────────

    def load(self, session_id: str) -> FAISS:
        """
        Load (and cache) a persisted FAISS index for the given session.

        Args:
            session_id: Must match a session previously built with build().

        Raises:
            FileNotFoundError: If no index exists for this session_id.
        """
        if session_id in self._stores:
            return self._stores[session_id]

        save_path = self._session_path(session_id)
        if not save_path.exists():
            raise FileNotFoundError(
                f"No FAISS index found for session '{session_id}'. "
                "Upload a PDF first."
            )

        logger.info("Loading FAISS index from '%s'.", save_path)
        store = FAISS.load_local(
            folder_path=str(save_path),
            embeddings=self._embedding_service.embeddings,
            allow_dangerous_deserialization=True,  # safe: we wrote this file ourselves
        )
        self._stores[session_id] = store
        return store

    # ── Search ────────────────────────────────────────────────────────────────

    def search(
        self,
        query: str,
        session_id: str,
        k: int = 5,
    ) -> Tuple[List[Document], List[float]]:
        """
        Retrieve the top-K most similar chunks for a query.

        Args:
            query:      The student's question (plain text).
            session_id: Identifies which FAISS index to search.
            k:          Number of chunks to return.

        Returns:
            Tuple of (documents, scores) — parallel lists, sorted by score desc.
        """
        store = self.load(session_id)
        results: List[Tuple[Document, float]] = store.similarity_search_with_score(
            query=query,
            k=k,
        )

        if not results:
            return [], []

        documents, scores = zip(*results)

        # FAISS returns L2 distances; convert to similarity (lower = closer)
        # We normalise so the API always exposes a 0–1 score (1 = perfect match)
        max_score = max(scores) if scores else 1.0
        normalised = [
            round(1.0 - (s / (max_score + 1e-9)), 4) for s in scores
        ]

        return list(documents), normalised

    # ── Introspection ─────────────────────────────────────────────────────────

    def exists(self, session_id: str) -> bool:
        """Return True if a FAISS index exists on disk for this session."""
        return self._session_path(session_id).exists()

    def vector_count(self, session_id: str) -> int:
        """Return the number of vectors in the session's FAISS index."""
        try:
            store = self.load(session_id)
            return store.index.ntotal
        except FileNotFoundError:
            return 0

    # ── Private helpers ───────────────────────────────────────────────────────

    def _session_path(self, session_id: str) -> Path:
        return self._db_dir / session_id
