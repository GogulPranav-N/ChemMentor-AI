# ⚗️ ChemMentor — AI-Powered Chemistry Tutor

> A production-quality **Retrieval-Augmented Generation (RAG)** system that answers chemistry questions **strictly from an uploaded PDF** — never hallucinating, always citing the source page.

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![LangChain](https://img.shields.io/badge/LangChain-0.2-1C3C3C)](https://langchain.com)
[![FAISS](https://img.shields.io/badge/FAISS-CPU-blue)](https://github.com/facebookresearch/faiss)
[![Gemini](https://img.shields.io/badge/Google-Gemini-4285F4?logo=google)](https://ai.google.dev)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [Docker Deployment](#docker-deployment)
- [API Reference](#api-reference)
- [Design Decisions](#design-decisions)
- [Future Improvements](#future-improvements)

---

## Overview

ChemMentor is built for the **HAWC AI Chemistry Tutor Challenge**. Students upload a chemistry textbook chapter as a PDF, and the system:

1. Extracts text with **page-level metadata** (PyMuPDF)
2. Chunks the document into overlapping segments (LangChain `RecursiveCharacterTextSplitter`)
3. Generates dense embeddings (**BAAI/bge-base-en-v1.5**)
4. Stores vectors in a **per-session FAISS index**
5. At query time, retrieves the **top-5 most relevant chunks**
6. Sends a strictly grounded prompt to **Google Gemini**
7. Returns a structured response: **answer + page citations + related topics**

If the answer cannot be found in the document, the system responds exactly:
> *"The answer is not present in the provided chapter."*

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Browser (UI)                              │
│  ┌─────────────┐   ┌──────────────────┐   ┌──────────────────┐  │
│  │  PDF Upload │   │  Question Input  │   │   Answer Panel   │  │
│  └──────┬──────┘   └────────┬─────────┘   └──────────┬───────┘  │
│         │                   │                         │           │
└─────────┼───────────────────┼─────────────────────────┼───────────┘
          │ POST /upload       │ POST /ask               │ JSON
          ▼                   ▼                         │
┌──────────────────────────────────────────────────────────────────┐
│                        FastAPI Backend                            │
│                                                                   │
│   upload.py ──► parser.py ──► chunker.py ──► embeddings.py       │
│                                                   │               │
│                                            vector_store.py        │
│                                                   │               │
│   ask.py ──► retriever.py ──► prompt.py ──► llm.py               │
└──────────────────────────────────────────────────────────────────┘
          │                   │
     PyMuPDF              FAISS + BGE          Google Gemini API
   (PDF extract)          (retrieval)           (answer gen)
```

### RAG Pipeline Detail

```
PDF File
  │
  ▼
PDFParser (PyMuPDF)
  │  → List[PageContent(page_number, text)]
  ▼
DocumentChunker (RecursiveCharacterTextSplitter)
  │  chunk_size=700, chunk_overlap=100
  │  → List[Document(text, metadata={page, chunk_index, source_file})]
  ▼
EmbeddingService (BAAI/bge-base-en-v1.5)
  │  → dense vectors (768-dim)
  ▼
VectorStoreManager (FAISS)
  │  → persisted to vector_db/<session_id>/
  ▼
[at query time]
  ▼
similarity_search(query, k=5)
  │  → Top-K Documents + L2-normalised scores
  ▼
PromptBuilder
  │  → grounded prompt with page citations
  ▼
GeminiLLMClient (gemini-1.5-flash)
  │  → structured JSON: {answer, related_topics}
  ▼
AskResponse (answer + SourceReference[] + related_topics[])
```

---

## Project Structure

```
chemistry-ai-tutor/
├── main.py                  # FastAPI app entry point (lifespan, routers, middleware)
├── requirements.txt         # Pinned Python dependencies
├── .env.example             # Environment variable template
├── Dockerfile               # Production Docker image
├── docker-compose.yml       # Docker Compose with named volumes
│
├── app/
│   ├── api/
│   │   ├── upload.py        # POST /upload  — PDF ingestion pipeline
│   │   ├── ask.py           # POST /ask     — RAG query pipeline
│   │   └── health.py        # GET  /health  — status & model info
│   │
│   ├── rag/
│   │   ├── parser.py        # PDFParser — PyMuPDF text extraction
│   │   ├── chunker.py       # DocumentChunker — text splitting
│   │   ├── embeddings.py    # EmbeddingService — singleton BGE model
│   │   ├── vector_store.py  # VectorStoreManager — FAISS index CRUD
│   │   ├── retriever.py     # ContextRetriever — pipeline orchestrator
│   │   ├── prompt.py        # PromptBuilder — grounded prompt assembly
│   │   └── llm.py           # GeminiLLMClient — API call + JSON parsing
│   │
│   ├── models/
│   │   └── schemas.py       # Pydantic v2 request/response models
│   │
│   ├── utils/
│   │   └── helpers.py       # Logging, file utils, source formatting
│   │
│   ├── templates/
│   │   └── index.html       # Single-page UI (Jinja2 served)
│   │
│   └── static/
│       ├── style.css        # Dark glassmorphism design system
│       └── script.js        # Vanilla JS — upload, chat, drawer, toasts
│
├── uploads/                 # PDF files saved per session
├── vector_db/               # FAISS indices saved per session
└── source/                  # Drop sample PDFs here for testing
```

---

## Prerequisites

| Requirement | Version |
|---|---|
| Python | 3.11+ |
| pip | Latest |
| Google Gemini API Key | [Get one free](https://aistudio.google.com/app/apikey) |
| Docker (optional) | 24+ |

---

## Installation

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd chemistry-ai-tutor

# 2. Create and activate a virtual environment
python3.11 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment variables
cp .env.example .env
# Open .env and set GEMINI_API_KEY=your_key_here
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | **required** | Google Gemini API key |
| `GEMINI_MODEL` | `gemini-1.5-flash` | Gemini model to use |
| `GEMINI_MAX_TOKENS` | `1024` | Maximum output tokens |
| `EMBEDDING_MODEL` | `BAAI/bge-base-en-v1.5` | HuggingFace embedding model |
| `CHUNK_SIZE` | `700` | Characters per chunk |
| `CHUNK_OVERLAP` | `100` | Overlap between chunks |
| `TOP_K` | `5` | Chunks retrieved per query |
| `UPLOAD_DIR` | `uploads` | PDF storage directory |
| `VECTOR_DB_DIR` | `vector_db` | FAISS index storage directory |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

---

## Running Locally

```bash
# Ensure .env is configured, then:
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000** in your browser.

- Interactive API docs: **http://localhost:8000/docs**
- ReDoc: **http://localhost:8000/redoc**

> **Note:** First startup downloads the BAAI/bge-base-en-v1.5 model (~440 MB). Subsequent startups use the cached model.

---

## Docker Deployment

```bash
# Build and start
docker compose up --build

# Or run the image directly
docker build -t che-mentor .
docker run -p 8000:8000 --env-file .env che-mentor
```

Data is persisted via named volumes (`che_uploads`, `che_vectordb`) across container restarts.

---

## API Reference

### `GET /health`

Returns application health and model information.

```bash
curl http://localhost:8000/health
```

```json
{
  "status": "ok",
  "app_name": "Chemistry AI Tutor",
  "version": "1.0.0",
  "gemini_model": "gemini-1.5-flash",
  "embedding_model": "BAAI/bge-base-en-v1.5",
  "index_stats": { "session_id": null, "vector_count": 0, "embedding_model": "..." }
}
```

---

### `POST /upload`

Upload a chemistry PDF for indexing.

```bash
curl -X POST http://localhost:8000/upload \
  -F "file=@/path/to/chemistry_chapter.pdf"
```

**Response `201`:**
```json
{
  "session_id": "3f4a1b2c-...",
  "file_name": "chemistry_chapter.pdf",
  "page_count": 42,
  "chunk_count": 187,
  "message": "Document indexed successfully. You can now ask questions."
}
```

---

### `POST /ask`

Ask a question grounded in the uploaded document.

```bash
curl -X POST http://localhost:8000/ask \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is Le Chatelier'\''s principle?",
    "session_id": "3f4a1b2c-...",
    "top_k": 5
  }'
```

**Response `200`:**
```json
{
  "answer": "Le Chatelier's principle states that if a system at equilibrium is disturbed, it will shift to counteract the disturbance (Page 23).",
  "sources": [
    { "page": 23, "chunk_index": 45, "content": "...", "score": 0.92 },
    { "page": 24, "chunk_index": 46, "content": "...", "score": 0.87 }
  ],
  "related_topics": ["Chemical Equilibrium", "Reaction Quotient", "Haber Process"],
  "session_id": "3f4a1b2c-..."
}
```

---

## Design Decisions

| Decision | Rationale |
|---|---|
| **Per-session FAISS index** | Isolates documents; multiple PDFs can coexist |
| **Singleton EmbeddingService** | 440 MB model loaded once; shared across all requests |
| **BAAI/bge-base-en-v1.5** | MTEB top performer for retrieval; open-source; no API cost |
| **`response_mime_type="application/json"`** | Instructs Gemini to return structured JSON natively |
| **`temperature=0.2`** | Low temperature minimises hallucination risk |
| **Lifespan context manager** | FastAPI best practice; model ready before first request |
| **Pydantic v2 schemas** | Auto-generated OpenAPI docs; type-safe across all layers |
| **Tenacity retry** | Handles Gemini 429 / transient errors gracefully |
| **Non-root Docker user** | Security best practice; prevents container escape |

---

## Future Improvements

- [ ] **Redis session store** — replace in-memory dict for multi-instance deployments
- [ ] **Streaming responses** — stream Gemini output token-by-token via SSE
- [ ] **Multi-document sessions** — allow uploading multiple chapters into one index
- [ ] **Re-ranking** — add cross-encoder re-ranking layer (e.g., `ms-marco-MiniLM`) for precision
- [ ] **Conversation memory** — maintain multi-turn context per session
- [ ] **Highlight source paragraph** — highlight retrieved text directly in a PDF viewer
- [ ] **User authentication** — JWT-based auth for multi-student deployments
- [ ] **Async ingestion** — move PDF processing to a Celery / ARQ background worker
- [ ] **Evaluation harness** — RAGAS metrics (faithfulness, answer relevancy, context recall)
- [ ] **GPU support** — switch to `faiss-gpu` and `device=cuda` for larger corpora

---

## License

MIT — see [LICENSE](LICENSE) for details.
