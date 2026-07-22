"""
PDF parsing layer.

Uses PyMuPDF (fitz) to extract text page-by-page while preserving
page-number metadata — critical for source citation in RAG responses.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import List

import fitz  # PyMuPDF

from app.utils.helpers import setup_logger

logger = setup_logger(__name__)


@dataclass
class PageContent:
    """Represents the extracted text content of a single PDF page."""

    page_number: int          # 1-indexed
    text: str
    char_count: int = field(init=False)

    def __post_init__(self) -> None:
        self.char_count = len(self.text)

    @property
    def is_meaningful(self) -> bool:
        """Returns True when the page has enough text to be worth indexing."""
        return self.char_count > 50


class PDFParser:
    """
    Extracts text from a PDF file page-by-page using PyMuPDF.

    Design notes:
    - Each page is returned as an independent PageContent object so that
      page-number metadata flows through to every downstream chunk.
    - Empty / near-empty pages (e.g., image-only pages) are skipped to
      avoid polluting the vector store with noise.
    """

    def __init__(self, min_page_chars: int = 50) -> None:
        self._min_chars = min_page_chars

    def parse(self, pdf_path: str | Path) -> List[PageContent]:
        """
        Open the PDF and extract text from every page.

        Args:
            pdf_path: Absolute or relative path to the PDF file.

        Returns:
            List of PageContent objects, one per non-empty page.

        Raises:
            FileNotFoundError: If the PDF does not exist.
            RuntimeError:      If PyMuPDF fails to open / read the file.
        """
        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        logger.info("Parsing PDF: %s", pdf_path.name)

        try:
            doc = fitz.open(str(pdf_path))
        except Exception as exc:
            raise RuntimeError(f"Failed to open PDF '{pdf_path.name}': {exc}") from exc

        pages: List[PageContent] = []

        with doc:
            total = len(doc)
            logger.info("Total pages detected: %d", total)

            for idx in range(total):
                page = doc[idx]
                text = page.get_text("text")          # plain-text extraction
                text = self._clean_text(text)

                page_content = PageContent(
                    page_number=idx + 1,   # convert 0-indexed → 1-indexed
                    text=text,
                )

                if page_content.is_meaningful:
                    pages.append(page_content)
                else:
                    logger.debug("Skipping page %d (too little text).", idx + 1)

        logger.info(
            "Parsing complete. %d/%d pages retained.", len(pages), total
        )
        return pages

    # ── Private helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _clean_text(text: str) -> str:
        """
        Normalize whitespace without collapsing paragraph breaks.

        Replaces runs of spaces/tabs with a single space while preserving
        newlines so that the chunker can use them as natural split points.
        """
        import re
        # Collapse horizontal whitespace (spaces/tabs) without touching newlines
        text = re.sub(r"[ \t]+", " ", text)
        # Remove lines that are purely whitespace
        lines = [line for line in text.splitlines() if line.strip()]
        return "\n".join(lines)
