"""
Prompt engineering layer.

Builds the final prompt sent to Gemini. Keeping prompt construction isolated
from the LLM client makes it easy to iterate on prompt strategy without
touching infrastructure code.
"""

from __future__ import annotations

from typing import List

from langchain.schema import Document


# ── System instruction ────────────────────────────────────────────────────────

SYSTEM_INSTRUCTION = """You are an AI Chemistry Tutor assistant.

STRICT RULES — you must follow these without exception:
1. Answer ONLY using the information found in the context sections below.
2. NEVER use external knowledge, training data, or general chemistry facts.
3. If the question cannot be answered from the provided context, respond with exactly:
   "The answer is not present in the provided chapter."
4. Always cite the source page number(s) in your answer, e.g. "(Page 12)".
5. Be clear, concise, and educational in your explanations.
6. After your answer, suggest up to 4 related chemistry topics from the context that the student might explore next.

OUTPUT FORMAT (JSON):
{
  "answer": "<your answer with page citations>",
  "related_topics": ["<topic 1>", "<topic 2>", "<topic 3>", "<topic 4>"]
}

Return ONLY valid JSON. No markdown fences, no extra text.
"""


class PromptBuilder:
    """
    Assembles the full prompt for Gemini from retrieved context chunks.

    The prompt follows a structured format:
        [System instruction]
        [Context blocks with page numbers]
        [Student question]

    Separating prompt building from LLM invocation allows unit-testing the
    prompt content without making API calls.
    """

    @staticmethod
    def build(question: str, documents: List[Document]) -> str:
        """
        Construct a grounded prompt from the question and retrieved chunks.

        Args:
            question:  The student's raw question string.
            documents: Top-K LangChain Documents from FAISS similarity search.

        Returns:
            A fully formatted prompt string ready to send to Gemini.
        """
        context_blocks = PromptBuilder._format_context(documents)
        prompt = (
            f"{SYSTEM_INSTRUCTION}\n\n"
            f"--- CONTEXT FROM DOCUMENT ---\n"
            f"{context_blocks}\n"
            f"--- END OF CONTEXT ---\n\n"
            f"STUDENT QUESTION: {question.strip()}\n\n"
            f"Remember: answer ONLY from the context above. Return valid JSON."
        )
        return prompt

    @staticmethod
    def _format_context(documents: List[Document]) -> str:
        """
        Format each retrieved chunk as a labeled block with its page number.

        Example output:
            [Chunk 1 | Page 14]
            Oxidation is the process by which an element loses electrons...

            [Chunk 2 | Page 15]
            ...
        """
        if not documents:
            return "(No relevant context was retrieved from the document.)"

        blocks: List[str] = []
        for idx, doc in enumerate(documents, start=1):
            page = doc.metadata.get("page", "?")
            text = doc.page_content.strip()
            blocks.append(f"[Chunk {idx} | Page {page}]\n{text}")

        return "\n\n".join(blocks)
