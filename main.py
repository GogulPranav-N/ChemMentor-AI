"""
Chemistry AI Tutor — FastAPI Application Entry Point.

Bootstraps the application using FastAPI's lifespan context manager to:
- Load the singleton embedding model at startup (prevents cold-start on first request)
- Initialise the Gemini LLM client
- Mount static files and Jinja2 templates
- Register all API routers
- Configure CORS, global exception handling, and structured logging
"""

from __future__ import annotations

import logging
import os
import time
import warnings
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator

# Suppress non-fatal FutureWarnings from Google SDK on Python 3.9
warnings.filterwarnings("ignore", category=FutureWarning, module="google")
warnings.filterwarnings("ignore", category=UserWarning, module="urllib3")

from dotenv import load_dotenv
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.api.ask import router as ask_router
from app.api.health import router as health_router
from app.api.session import router as session_router
from app.api.upload import router as upload_router
from app.models.schemas import ErrorResponse
from app.rag.embeddings import EmbeddingService
from app.rag.llm import GeminiLLMClient
from app.rag.retriever import ContextRetriever
from app.utils.helpers import ensure_dirs, setup_logger

# ── Environment ───────────────────────────────────────────────────────────────

load_dotenv()  # load from .env if present

# ── Logger ────────────────────────────────────────────────────────────────────

logger = setup_logger("main", level=os.getenv("LOG_LEVEL", "INFO"))

# ── App-level shared state ────────────────────────────────────────────────────
# Stored here (rather than FastAPI.state) so API modules can import it directly
# without circular dependency issues.

app_state: dict[str, Any] = {}


# ── Lifespan ──────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    FastAPI lifespan context manager — runs setup on startup and teardown on shutdown.

    Loading the embedding model here (rather than lazily) ensures the first
    request is never penalised by model load time.
    """
    logger.info("═" * 60)
    logger.info("  Chemistry AI Tutor — starting up")
    logger.info("═" * 60)

    # Required directories
    upload_dir = os.getenv("UPLOAD_DIR", "uploads")
    vector_db_dir = os.getenv("VECTOR_DB_DIR", "vector_db")
    ensure_dirs(upload_dir, vector_db_dir, "source")
    app_state["upload_dir"] = upload_dir

    # Embedding model (singleton — loaded once, shared forever)
    embedding_model = os.getenv("EMBEDDING_MODEL", "BAAI/bge-base-en-v1.5")
    logger.info("Loading embedding model: %s", embedding_model)
    EmbeddingService.get_instance(model_name=embedding_model)

    # Retriever (orchestrates parse → chunk → embed → FAISS)
    app_state["retriever"] = ContextRetriever(
        chunk_size=int(os.getenv("CHUNK_SIZE", "700")),
        chunk_overlap=int(os.getenv("CHUNK_OVERLAP", "100")),
        top_k=int(os.getenv("TOP_K", "5")),
        vector_db_dir=vector_db_dir,
        embedding_model=embedding_model,
    )

    # Gemini LLM client
    api_key = os.getenv("GEMINI_API_KEY", "")
    _placeholder = not api_key or api_key == "your_gemini_api_key_here"
    if _placeholder:
        logger.warning(
            "⚠️  GEMINI_API_KEY is not set. "
            "The /ask endpoint will fail until you add a valid key to .env."
        )
        app_state["llm_client"] = None
    else:
        app_state["llm_client"] = GeminiLLMClient(
            api_key=api_key,
            model_name=os.getenv("GEMINI_MODEL", "gemini-3.5-flash"),
            max_output_tokens=None,  # Do not set output token limit to avoid truncation bugs in current API
        )
    app_state["active_session_id"] = None

    logger.info("All services initialised. Application ready.")
    logger.info("═" * 60)

    yield  # ← application runs here

    # Graceful shutdown
    logger.info("Chemistry AI Tutor shutting down.")
    app_state.clear()


# ── FastAPI application ────────────────────────────────────────────────────────

app = FastAPI(
    title="Chemistry AI Tutor",
    description=(
        "A production-quality RAG application that answers chemistry questions "
        "strictly from an uploaded PDF textbook chapter using Google Gemini."
    ),
    version=os.getenv("APP_VERSION", "1.0.0"),
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────

_ENV = os.getenv("ENVIRONMENT", "development").lower()
_CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",") if _ENV == "production" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global exception handler ──────────────────────────────────────────────────


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all handler — prevents raw stack traces leaking to clients."""
    logger.exception("Unhandled exception on %s %s", request.method, request.url)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=ErrorResponse(
            error="Internal Server Error",
            detail="An unexpected error occurred. Please try again.",
            status_code=500,
        ).model_dump(),
    )


# ── Static files & templates ──────────────────────────────────────────────────

_BASE = Path(__file__).parent

app.mount(
    "/static",
    StaticFiles(directory=str(_BASE / "app" / "static")),
    name="static",
)

templates = Jinja2Templates(directory=str(_BASE / "app" / "templates"))


@app.middleware("http")
async def handle_static_cache_headers(request: Request, call_next):
    """Set appropriate cache headers for static assets based on environment."""
    response = await call_next(request)
    if request.url.path.startswith("/static"):
        if _ENV == "production":
            response.headers["Cache-Control"] = "public, max-age=86400, stale-while-revalidate=3600"
        else:
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
    return response


@app.get("/", include_in_schema=False)
async def serve_ui(request: Request):
    """Serve the single-page UI with automatic cache-busting."""
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "cache_buster": int(time.time())},
    )


# ── API Routers ───────────────────────────────────────────────────────────────

app.include_router(health_router)
app.include_router(upload_router)
app.include_router(ask_router)
app.include_router(session_router)


# ── Dev entrypoint ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )
