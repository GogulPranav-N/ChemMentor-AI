"""
POST /ask — question answering endpoint.

Accepts a student question and session_id, retrieves the most relevant
chunks from FAISS, builds a grounded prompt, calls Gemini, and returns
a structured answer with source citations and related topics.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.models.schemas import AskRequest, AskResponse
from app.rag.prompt import PromptBuilder
from app.utils.helpers import format_sources, setup_logger

logger = setup_logger(__name__)

router = APIRouter(tags=["Ask"])


@router.post(
    "/ask",
    response_model=AskResponse,
    summary="Ask a Chemistry Question",
    description=(
        "Submit a chemistry question tied to an uploaded document session. "
        "The system retrieves relevant context from FAISS and generates an answer "
        "strictly grounded in the document content using Google Gemini."
    ),
)
async def ask_question(request: AskRequest) -> AskResponse:
    """
    RAG query pipeline:
    1. Validate the session exists.
    2. Retrieve top-K chunks from FAISS.
    3. Build grounded prompt.
    4. Call Gemini to generate answer.
    5. Return structured response with sources and related topics.
    """
    from main import app_state  # type: ignore[import]

    retriever = app_state.get("retriever")
    llm_client = app_state.get("llm_client")

    if retriever is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG pipeline is not yet initialised.",
        )
    if llm_client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "GEMINI_API_KEY is not configured. "
                "Add your key to the .env file and restart the server."
            ),
        )


    # ── Validate session ──────────────────────────────────────────────────────

    if not retriever.session_exists(request.session_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Session '{request.session_id}' not found. "
                "Please upload a PDF first using the /upload endpoint."
            ),
        )

    # ── Retrieve ──────────────────────────────────────────────────────────────

    try:
        documents, scores = retriever.retrieve(
            question=request.question,
            session_id=request.session_id,
            k=request.top_k,
        )
    except Exception as exc:
        logger.exception("Retrieval failed for session '%s'.", request.session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Retrieval error: {exc}",
        )

    if not documents:
        # No chunks found — return the fallback without calling the LLM
        return AskResponse(
            answer="The answer is not present in the provided chapter.",
            sources=[],
            related_topics=[],
            session_id=request.session_id,
        )

    # ── Generate answer ───────────────────────────────────────────────────────

    prompt = PromptBuilder.build(
        question=request.question,
        documents=documents,
    )

    try:
        llm_response = llm_client.generate(prompt)
    except Exception as exc:
        logger.exception("Gemini API call failed.")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LLM generation failed: {exc}",
        )

    # ── Format sources ────────────────────────────────────────────────────────

    sources = format_sources(documents=documents, scores=scores)

    logger.info(
        "Answer generated for session '%s'. Sources: %d pages cited.",
        request.session_id,
        len({s.page for s in sources}),
    )

    return AskResponse(
        answer=llm_response.answer,
        equations=[
            {"equation": eq.equation, "label": eq.label}
            for eq in (llm_response.equations or [])
        ],
        sources=sources,
        related_topics=llm_response.related_topics,
        session_id=request.session_id,
    )
