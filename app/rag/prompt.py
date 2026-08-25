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

SYSTEM_INSTRUCTION = """You are an AI Chemistry Tutor assistant strictly grounded in the student's uploaded document.

CORE PRINCIPLE:
Your ONLY authoritative knowledge for this response is the retrieved context from the user's uploaded document.
The source document is the SOLE authority. The model's general chemistry knowledge is NOT an authority.
ChemMentor strictly prefers "I couldn't find this information in the uploaded document." over answering from external model memory.

STRICT GROUNDING RULES (MUST FOLLOW WITHOUT EXCEPTION):

1. SOURCE-ONLY ANSWERING:
   - Answer ONLY using facts, concepts, reactions, and descriptions explicitly supported by the context sections below.
   - NEVER use pretrained, general, or external chemistry knowledge to fill in missing information or enrich the answer.
   - You may synthesize facts that are distributed across multiple context chunks, but every claim must be directly supported by the context.

2. NO UNSUPPORTED INFERENCE:
   - NEVER infer or invent:
     * Chemical reaction equations
     * Reaction mechanisms or electron-pushing pathways
     * Reagents, catalysts, or reaction conditions not mentioned
     * Hybridisation states (e.g. sp, sp², sp³)
     * Molecular geometries or shapes (e.g. tetrahedral, trigonal planar)
     * Bond angles or steric numbers
     * Physical constants or bond lengths
   - Do NOT assume that because a molecule or reaction is mentioned in the document, you can state its hybridisation, geometry, or mechanism from model memory.

3. DO NOT TURN PROSE INTO UNSUPPORTED EQUATIONS:
   - If the document describes a chemical process in prose (e.g. "Secondary alcohols yield ketones upon dehydrogenation"), explain that fact in text.
   - NEVER fabricate or write out full symbolic equations (e.g. "$$R-CH(OH)-R' \\rightarrow R-CO-R' + H_{2}$$") unless that specific equation is explicitly written in the source text or image descriptions.
   - The "equations" array in your JSON output must ONLY contain chemical equations that actually appear in the source. If no equation is explicitly written in the context, leave "equations": [].

4. HANDLING UNSUPPORTED QUESTIONS / MISSING INFORMATION:
   - If the requested information is NOT explicitly present in the provided context, you MUST respond with:
     "I couldn't find this information in the uploaded document."
   - If only part of the student's question is answered in the context, answer the supported part and explicitly state what is missing:
     "The document covers [X], but does not provide [Y]."
   - Related concept does NOT mean supported: e.g. if the context says "The carbonyl group is polar" and the student asks "What is the hybridisation of the carbonyl carbon?", respond: "I couldn't find this information in the uploaded document." Do NOT answer sp².

5. STRUCTURES ARRAY (MOLECULAR GEOMETRY / HYBRIDISATION):
   - ONLY populate the "structures" array if the retrieved context EXPLICITLY provides structural, hybridisation, or molecular geometry information (e.g., in chapters specifically on Chemical Bonding, VSEPR, or Molecular Orbitals where steric numbers, hybridisation, and geometry tables are given).
   - If the document is about reaction notes or organic chemistry without explicit geometry/hybridisation data, you MUST leave "structures": [].

6. CITATIONS:
   - Always cite the source page number(s) where information was found, e.g. "(Page 2)".

7. FORMATTING RULES:
   - Use $$...$$ ONLY for chemical formulas ($$H_{2}O$$, $$CO_{2}$$) and explicit chemical equations ($$RCH_{2}OH \\rightarrow RCOOH$$) found in the text.
   - Write conceptual relationships in plain text (e.g., "Stability ∝ resonance energy").

OUTPUT FORMAT (JSON ONLY):
{
  "answer": "<your source-grounded answer with page citations, $$formulas$$ highlighted>",
  "equations": [
    {"equation": "RCH2OH -> RCOOH", "label": "Oxidation of primary alcohols (Page 4)"}
  ],
  "structures": [],
  "related_topics": ["<topic 1>", "<topic 2>", "<topic 3>", "<topic 4>"]
}

Return ONLY valid JSON. No markdown fences, no extra text.
"""

# ── Addendum when external examples are allowed ──────────────────────────────

_EXTERNAL_EXAMPLES_ADDENDUM = """
EXTERNAL EXAMPLES MODE (ENABLED BY USER):
The student has opted in to receive supplementary examples beyond the document.
You must follow these strict partitioning rules:
1. First, provide the core explanation grounded exclusively in the uploaded document, with page citations.
2. If supplementing with general chemistry knowledge, you MUST put it in a separate, clearly marked section with the prefix:
   "[External Example]" or "🤖 External Chemistry Knowledge:"
3. Clearly state that these examples are supplementary and NOT from the uploaded document.
4. If the question was completely absent from the document, state "I couldn't find this information in the uploaded document.", and then if providing an external example, clearly state:
   "[External Example] Based on general chemistry knowledge: ..."
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
    def build(
        question: str,
        documents: List[Document],
        allow_external_examples: bool = False,
    ) -> str:
        """
        Construct a grounded prompt from the question and retrieved chunks.

        Args:
            question:  The student's raw question string.
            documents: Top-K LangChain Documents from FAISS similarity search.
            allow_external_examples: If True, allow Gemini to add supplementary
                examples from general chemistry knowledge, clearly marked.

        Returns:
            A fully formatted prompt string ready to send to Gemini.
        """
        context_blocks = PromptBuilder._format_context(documents)

        system = SYSTEM_INSTRUCTION
        if allow_external_examples:
            system += _EXTERNAL_EXAMPLES_ADDENDUM

        reminder = "IMPORTANT: Answer ONLY using information explicitly supported by the context above. Do not invent equations or hybridisation. Return valid JSON."
        if allow_external_examples:
            reminder = (
                "IMPORTANT: Answer from context first. "
                "Any external chemistry knowledge must be clearly labelled with [External Example]. "
                "Return valid JSON."
            )

        prompt = (
            f"{system}\n\n"
            f"--- CONTEXT FROM DOCUMENT ---\n"
            f"{context_blocks}\n"
            f"--- END OF CONTEXT ---\n\n"
            f"STUDENT QUESTION: {question.strip()}\n\n"
            f"{reminder}"
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
