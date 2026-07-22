"""
Document chunking layer.

Wraps LangChain's RecursiveCharacterTextSplitter and enriches every chunk
with provenance metadata so that source citations survive to the API response.
"""

from __future__ import annotations

from typing import List

from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.schema import Document

from app.rag.parser import PageContent
from app.utils.helpers import setup_logger

logger = setup_logger(__name__)


class DocumentChunker:
    """
    Splits page-level text into overlapping chunks suitable for embedding.

    Configuration:
        chunk_size    – target character length per chunk (default 700).
        chunk_overlap – characters shared between adjacent chunks (default 100).
                        Overlap ensures that answers spanning a chunk boundary
                        are still retrievable.

    Each LangChain Document produced carries:
        metadata.page         – 1-indexed source page number
        metadata.source_file  – original filename of the PDF
        metadata.chunk_index  – sequential position of this chunk (document-wide)
    """

    def __init__(
        self,
        chunk_size: int = 700,
        chunk_overlap: int = 100,
        source_file: str = "unknown",
    ) -> None:
        self._source_file = source_file
        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            # Prefer splitting on paragraph/sentence boundaries first
            separators=["\n\n", "\n", ". ", "! ", "? ", " ", ""],
            length_function=len,
        )

    def chunk(self, pages: List[PageContent]) -> List[Document]:
        """
        Convert a list of PageContent objects into overlapping LangChain Documents.

        Args:
            pages: Output from PDFParser.parse().

        Returns:
            Flat list of Documents with page and chunk-level metadata.
        """
        all_chunks: List[Document] = []
        global_chunk_index = 0

        for page in pages:
            # Split this page's text into chunks
            raw_chunks: List[str] = self._splitter.split_text(page.text)

            for local_idx, chunk_text in enumerate(raw_chunks):
                if not chunk_text.strip():
                    continue  # skip empty splits

                doc = Document(
                    page_content=chunk_text,
                    metadata={
                        "page": page.page_number,
                        "source_file": self._source_file,
                        "chunk_index": global_chunk_index,
                        "local_chunk_index": local_idx,
                    },
                )
                all_chunks.append(doc)
                global_chunk_index += 1

        logger.info(
            "Chunking complete. %d chunks from %d pages (file: %s).",
            len(all_chunks),
            len(pages),
            self._source_file,
        )
        return all_chunks
