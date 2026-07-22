"""
Embedding service layer.

Wraps HuggingFace SentenceTransformers via LangChain's HuggingFaceEmbeddings
with a singleton pattern so the 400 MB model is loaded exactly once at startup
and reused across all requests.
"""

from __future__ import annotations

from typing import List, Optional

from langchain_huggingface import HuggingFaceEmbeddings

from app.utils.helpers import setup_logger

logger = setup_logger(__name__)


class EmbeddingService:
    """
    Singleton wrapper around HuggingFaceEmbeddings.

    Why singleton?
    Loading the BAAI/bge-base-en-v1.5 model (~440 MB) takes ~3-5 seconds.
    Re-loading it on every request would make the API unusable. By loading
    once at application startup (via FastAPI's lifespan context), all requests
    share the same model instance in memory.

    Usage:
        service = EmbeddingService.get_instance()
        vectors = service.embed_documents(["text1", "text2"])
        query_vec = service.embed_query("what is oxidation?")
    """

    _instance: Optional["EmbeddingService"] = None

    def __init__(self, model_name: str = "BAAI/bge-base-en-v1.5") -> None:
        self._model_name = model_name
        logger.info("Loading embedding model: %s", model_name)
        self._embeddings = HuggingFaceEmbeddings(
            model_name=model_name,
            model_kwargs={"device": "cpu"},
            encode_kwargs={
                # BGE models perform best with this normalization flag
                "normalize_embeddings": True,
            },
        )
        logger.info("Embedding model loaded successfully.")

    # ── Singleton factory ─────────────────────────────────────────────────────

    @classmethod
    def get_instance(
        cls, model_name: str = "BAAI/bge-base-en-v1.5"
    ) -> "EmbeddingService":
        """Return the shared EmbeddingService instance, creating it if needed."""
        if cls._instance is None:
            cls._instance = cls(model_name=model_name)
        return cls._instance

    # ── Public API ────────────────────────────────────────────────────────────

    @property
    def embeddings(self) -> HuggingFaceEmbeddings:
        """Expose the raw LangChain embeddings object for FAISS integration."""
        return self._embeddings

    @property
    def model_name(self) -> str:
        return self._model_name

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Batch-embed a list of strings. Used during ingestion."""
        return self._embeddings.embed_documents(texts)

    def embed_query(self, text: str) -> List[float]:
        """Embed a single query string. Used during retrieval."""
        return self._embeddings.embed_query(text)
