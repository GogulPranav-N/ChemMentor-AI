"""
GET /health — application health check endpoint.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import HealthResponse, IndexStats
from app.utils.helpers import setup_logger

logger = setup_logger(__name__)

router = APIRouter(tags=["Health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Application Health Check",
    description="Returns current application status, model info, and FAISS index statistics.",
)
async def health_check() -> HealthResponse:
    """
    Returns application health status.

    Used by Docker HEALTHCHECK, load balancers, and monitoring systems.
    """
    # Import here to avoid circular import at module load time
    from main import app_state  # type: ignore[import]

    retriever = app_state.get("retriever")
    llm_client = app_state.get("llm_client")
    active_session = app_state.get("active_session_id")

    index_stats = IndexStats(
        session_id=active_session,
        vector_count=(
            retriever._vector_store.vector_count(active_session)
            if retriever and active_session
            else 0
        ),
        embedding_model=(
            retriever._embedding_service.model_name if retriever else ""
        ),
    )

    return HealthResponse(
        status="ok",
        app_name="Chemistry AI Tutor",
        version="1.0.0",
        gemini_model=llm_client.model_name if llm_client else "not initialised",
        embedding_model=index_stats.embedding_model,
        index_stats=index_stats,
    )
