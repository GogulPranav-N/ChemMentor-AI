# ─────────────────────────────────────────────────────────────────────────────
# Chemistry AI Tutor — Dockerfile
#
# Multi-stage build is not required here (no build step for Python), but we
# follow best practices: non-root user, minimal image, health-check.
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.11-slim

# ── Metadata ──────────────────────────────────────────────────────────────────
LABEL maintainer="Chemistry AI Tutor"
LABEL description="RAG-powered Chemistry Tutor using FastAPI + Gemini + FAISS"
LABEL version="1.0.0"

# ── System dependencies ───────────────────────────────────────────────────────
# libgomp1 is required by FAISS for OpenMP multi-threading
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Non-root user (security best practice) ───────────────────────────────────
RUN useradd --create-home --shell /bin/bash appuser

# ── Working directory ─────────────────────────────────────────────────────────
WORKDIR /app

# ── Install Python dependencies first (layer caching) ────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ── Copy application code ─────────────────────────────────────────────────────
COPY . .

# ── Create required directories and set ownership ────────────────────────────
RUN mkdir -p uploads vector_db source && \
    chown -R appuser:appuser /app

# ── Switch to non-root user ───────────────────────────────────────────────────
USER appuser

# ── Expose port ───────────────────────────────────────────────────────────────
EXPOSE 8000

# ── Health check ──────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# ── Entrypoint ────────────────────────────────────────────────────────────────
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
