"""
PDF parsing layer.

Uses PyMuPDF (fitz) to extract text page-by-page while preserving
page-number metadata — critical for source citation in RAG responses.

Additionally extracts embedded images and uses Google Gemini Vision
to describe chemical diagrams, reaction schemes, structural formulas,
and other visual content so it becomes searchable/retrievable context.
"""

from __future__ import annotations

import io
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

import fitz  # PyMuPDF

from app.utils.helpers import setup_logger

logger = setup_logger(__name__)

# Minimum image dimensions (pixels) to consider for Vision analysis.
# Tiny images are usually icons/bullets, not meaningful chemistry diagrams.
_MIN_IMAGE_WIDTH = 80
_MIN_IMAGE_HEIGHT = 80

# Maximum images to process per page to avoid excessive API calls
_MAX_IMAGES_PER_PAGE = 5

# Vision prompt for chemistry image description
_VISION_PROMPT = """You are a chemistry expert. Describe this image from a chemistry textbook in detail.

Focus on:
1. Chemical reactions (write them out with proper notation, e.g. 2H₂ + O₂ → 2H₂O)
2. Molecular structures and structural formulas
3. Orbital diagrams and electron configurations
4. Energy level diagrams
5. Phase diagrams, graphs, or data tables
6. Any text, labels, or annotations visible in the image

Be thorough and precise. Write out ALL chemical equations, formulas, and reactions you can identify.
If it contains a table, reproduce the table contents.
If it's a diagram, describe the relationships shown.

Return ONLY the description, no preamble."""


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
    - When a Gemini API key is available, images are extracted and
      described via Gemini Vision so that chemical diagrams, reactions,
      and structural formulas become part of the searchable context.
    """

    def __init__(
        self,
        min_page_chars: int = 50,
        enable_image_extraction: bool = True,
    ) -> None:
        self._min_chars = min_page_chars
        self._enable_image_extraction = enable_image_extraction
        self._vision_model = None  # lazy-init on first use

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

                # Extract and describe images on this page
                if self._enable_image_extraction:
                    image_descriptions = self._extract_and_describe_images(
                        doc, page, idx + 1
                    )
                    if image_descriptions:
                        text = text + "\n\n" + "\n\n".join(image_descriptions)

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

    # ── Image extraction & Vision description ─────────────────────────────────

    def _get_vision_model(self):
        """Lazy-initialise the Gemini Vision model."""
        if self._vision_model is not None:
            return self._vision_model

        try:
            import google.generativeai as genai

            api_key = os.getenv("GEMINI_API_KEY", "")
            if not api_key or api_key == "your_gemini_api_key_here":
                logger.warning(
                    "GEMINI_API_KEY not set — image extraction disabled."
                )
                self._enable_image_extraction = False
                return None

            genai.configure(api_key=api_key)

            # Use gemini-1.5-flash for vision — fast, cheap, supports images
            vision_model_name = os.getenv("GEMINI_VISION_MODEL", "gemini-1.5-flash")
            self._vision_model = genai.GenerativeModel(vision_model_name)
            logger.info("Gemini Vision model initialised: %s", vision_model_name)
            return self._vision_model
        except Exception as exc:
            logger.warning("Failed to initialise Gemini Vision: %s", exc)
            self._enable_image_extraction = False
            return None

    def _extract_and_describe_images(
        self,
        doc: fitz.Document,
        page: fitz.Page,
        page_number: int,
    ) -> List[str]:
        """
        Extract images from a PDF page and describe them using Gemini Vision.

        Returns a list of formatted image description strings.
        """
        descriptions: List[str] = []

        try:
            image_list = page.get_images(full=True)
        except Exception:
            return descriptions

        if not image_list:
            return descriptions

        # Limit to avoid API overuse
        image_list = image_list[:_MAX_IMAGES_PER_PAGE]
        processed = 0

        for img_info in image_list:
            try:
                xref = img_info[0]
                base_image = doc.extract_image(xref)
                if not base_image:
                    continue

                width = base_image.get("width", 0)
                height = base_image.get("height", 0)

                # Skip tiny images (icons, bullets, decorative elements)
                if width < _MIN_IMAGE_WIDTH or height < _MIN_IMAGE_HEIGHT:
                    continue

                image_bytes = base_image["image"]
                image_ext = base_image.get("ext", "png")

                description = self._describe_image(
                    image_bytes, image_ext, page_number, processed + 1
                )
                if description:
                    formatted = (
                        f"[IMAGE DESCRIPTION - Page {page_number}, "
                        f"Image {processed + 1}]: {description}"
                    )
                    descriptions.append(formatted)
                    processed += 1

            except Exception as exc:
                logger.debug(
                    "Failed to extract image from page %d: %s",
                    page_number, exc
                )
                continue

        if processed > 0:
            logger.info(
                "Described %d image(s) on page %d.", processed, page_number
            )
        return descriptions

    def _describe_image(
        self,
        image_bytes: bytes,
        image_ext: str,
        page_number: int,
        image_index: int,
    ) -> Optional[str]:
        """
        Send a single image to Gemini Vision and get a chemistry-focused description.

        Returns the description string, or None on failure.
        """
        model = self._get_vision_model()
        if model is None:
            return None

        try:
            import PIL.Image

            # Convert bytes to PIL Image
            image = PIL.Image.open(io.BytesIO(image_bytes))

            # Convert CMYK or palette images to RGB for the API
            if image.mode not in ("RGB", "RGBA", "L"):
                image = image.convert("RGB")

            response = model.generate_content(
                [_VISION_PROMPT, image],
                generation_config={
                    "temperature": 0.1,
                    "max_output_tokens": 1024,
                },
            )

            if response and response.text:
                description = response.text.strip()
                # Only keep descriptions that have meaningful chemistry content
                if len(description) > 20:
                    return description

        except Exception as exc:
            logger.debug(
                "Vision API failed for page %d, image %d: %s",
                page_number, image_index, exc
            )

        return None

    # ── Private helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _clean_text(text: str) -> str:
        """
        Normalize whitespace without collapsing paragraph breaks, clean
        repetitive coaching institute boilerplate headers/footers, and fix
        common PDF extraction artifacts for chemical arrows and symbols.
        """
        import re

        # Normalize common PDF font glyphs for chemical arrows
        text = text.replace("\uf0e0", "→")
        text = text.replace("\u2192", "→")
        text = text.replace("\u27f6", "→")
        text = text.replace("\u21cc", "⇌")
        text = text.replace("\u21c4", "⇌")
        text = text.replace("\u21d4", "⇌")

        # Collapse horizontal whitespace (spaces/tabs) without touching newlines
        text = re.sub(r"[ \t]+", " ", text)
        
        # Filter out repetitive document headers, footers, and contact details
        # that dilute semantic chunk embeddings across all pages
        boilerplate_patterns = [
            r"Corporate Office:\s*CG Tower.*",
            r"Website\s*:\s*www\.resonance\.ac\.in.*",
            r"Toll Free\s*:\s*1800.*",
            r"ADVCBO\s*-\s*\d+",
            r"^Chemical Bonding$"
        ]
        
        lines = []
        for line in text.splitlines():
            l_strip = line.strip()
            if not l_strip:
                continue
            if any(re.search(pat, l_strip, re.IGNORECASE) for pat in boilerplate_patterns):
                continue
            lines.append(l_strip)

        return "\n".join(lines)
