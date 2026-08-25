"""
Gemini LLM client.

Wraps google-generativeai with:
- Structured JSON response parsing
- Exponential back-off retry for rate limit / transient errors
- A clean dataclass return type so the API layer is decoupled from the SDK
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import List, Optional

import google.generativeai as genai
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
    before_sleep_log,
)

from app.utils.helpers import setup_logger

logger = setup_logger(__name__)

# Fallback answer when Gemini cannot parse / returns nothing
_FALLBACK_ANSWER = "The answer is not present in the provided chapter."


@dataclass
class EquationItem:
    """A single chemical equation with a descriptive label."""
    equation: str
    label: str = ""


@dataclass
class MolecularStructureItem:
    """Molecular geometry, hybridisation, and bonding details."""
    molecule: str
    central_atom: str = ""
    hybridisation: str = ""
    geometry: str = ""
    bond_angles: str = ""
    steric_number: Optional[int] = None
    lone_pairs: Optional[int] = None
    bond_pairs: Optional[int] = None
    diagram_ascii: str = ""


@dataclass
class LLMResponse:
    """Structured output from the Gemini LLM call."""

    answer: str
    equations: List[EquationItem] = field(default_factory=list)
    structures: List[MolecularStructureItem] = field(default_factory=list)
    related_topics: List[str] = field(default_factory=list)
    raw_response: str = field(default="", repr=False)


class GeminiLLMClient:
    """
    Thin, retryable wrapper around the Gemini generativeai SDK.

    Responsibilities:
    - Configure the SDK with the API key
    - Send prompts and receive raw text
    - Parse the structured JSON response from the model
    - Retry on transient failures with exponential back-off

    This class has NO knowledge of RAG, FAISS, or prompts — it only
    handles the Gemini API communication and response parsing.
    """

    def __init__(
        self,
        api_key: str,
        model_name: str = "gemini-1.5-flash",
        max_output_tokens: int | None = None,
        temperature: float = 0.2,
    ) -> None:
        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY is missing. "
                "Set it in your .env file before starting the application."
            )
        genai.configure(api_key=api_key)
        self._model_name = model_name

        config_kwargs = {
            "temperature": temperature,
            "response_mime_type": "application/json",
        }
        if max_output_tokens is not None:
            config_kwargs["max_output_tokens"] = max_output_tokens

        generation_config = genai.GenerationConfig(**config_kwargs)

        self._model = genai.GenerativeModel(
            model_name=model_name,
            generation_config=generation_config,
        )
        logger.info("Gemini client initialised. Model: %s", model_name)

    # ── Public API ────────────────────────────────────────────────────────────

    @property
    def model_name(self) -> str:
        return self._model_name

    def generate(self, prompt: str) -> LLMResponse:
        """
        Send a prompt to Gemini and return a parsed LLMResponse.

        Retries up to 3 times with exponential back-off on transient errors.

        Args:
            prompt: Fully assembled prompt string from PromptBuilder.

        Returns:
            LLMResponse with answer and related_topics.
        """
        raw = self._call_gemini(prompt)
        return self._parse_response(raw)

    # ── Private methods ───────────────────────────────────────────────────────

    @retry(
        retry=retry_if_exception_type(Exception),
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=2, min=3, max=35),
        before_sleep=before_sleep_log(logger, 20),  # 20 = logging.WARNING
        reraise=True,
    )
    def _call_gemini(self, prompt: str) -> str:
        """Make the API call with retry logic. Returns raw text."""
        import time
        logger.info("Calling Gemini API (model: %s).", self._model_name)
        try:
            response = self._model.generate_content(prompt)
            raw_text = response.text
            logger.info("Gemini response received (%d chars).", len(raw_text))
            return raw_text
        except Exception as exc:
            err_str = str(exc)
            if "429" in err_str or "ResourceExhausted" in err_str:
                # Extract suggested retry delay if present in error message
                delay_match = re.search(r"retry_delay\s*\{\s*seconds:\s*(\d+)", err_str)
                if delay_match:
                    sleep_sec = int(delay_match.group(1)) + 1
                    logger.warning("Gemini 429 quota reached. Backing off for %d seconds...", sleep_sec)
                    time.sleep(sleep_sec)
                    # Retry immediately after waiting out the quota
                    response = self._model.generate_content(prompt)
                    return response.text
            raise

    def _parse_response(self, raw: str) -> LLMResponse:
        """
        Parse the JSON response from Gemini into an LLMResponse.

        Gemini is instructed to return:
            {"answer": "...", "related_topics": ["...", ...]}

        Falls back gracefully if the response is malformed.
        """
        raw_clean = raw.strip()
        if not raw_clean:
            return LLMResponse(answer=_FALLBACK_ANSWER, related_topics=[])

        # Strip potential markdown fences
        clean = re.sub(r"```(?:json)?|```", "", raw_clean).strip()

        # Repair common JSON issues from LLM output:
        # 1. Fix invalid escape sequences in diagram_ascii (e.g., \n inside strings that are literal)
        # 2. Fix unescaped control characters
        repaired = self._repair_json(clean)

        # Try 1: Direct JSON load (with repaired string)
        for attempt_str in [repaired, clean]:
            try:
                data = json.loads(attempt_str)
                response = self._build_response_from_dict(data, raw)
                # Clean any leaked JSON from the answer text
                response.answer = self._clean_answer_text(response.answer)
                return response
            except Exception as e:
                logger.debug("JSON parse attempt failed: %s", str(e)[:200])

        # Try 2: Extract JSON object block using regex
        try:
            match = re.search(r"(\{.*\})", clean, re.DOTALL)
            if match:
                extracted = self._repair_json(match.group(1))
                data = json.loads(extracted)
                response = self._build_response_from_dict(data, raw)
                response.answer = self._clean_answer_text(response.answer)
                return response
        except Exception as e:
            logger.debug("JSON extraction attempt failed: %s", str(e)[:200])

        # Try 3: Regex match for "answer" and "related_topics" key values
        # This handles partially broken JSON or truncation
        try:
            answer_match = re.search(r'"answer"\s*:\s*"((?:[^"\\]|\\.)*)"', clean)
            answer = ""
            if answer_match:
                answer = json.loads(f'"{answer_match.group(1)}"')
            else:
                # Truncation fallback: extract the partial string when closing quote is missing
                answer = self._extract_incomplete_json_answer(clean)

            topics = []
            topics_match = re.search(r'"related_topics"\s*:\s*\[(.*?)\]', clean, re.DOTALL)
            if topics_match:
                items = re.findall(r'"((?:[^"\\]|\\.)*)"', topics_match.group(1))
                topics = [str(item).strip() for item in items]

            if answer:
                answer = self._clean_answer_text(answer)
                return LLMResponse(
                    answer=answer,
                    related_topics=topics[:4],
                    raw_response=raw,
                )
        except Exception:
            pass

        # Try 4: Check if the raw text is just plain text (doesn't look like JSON at all)
        if "{" not in clean and "}" not in clean and '"answer"' not in clean:
            return LLMResponse(
                answer=clean,
                related_topics=[],
                raw_response=raw,
            )

        # Fallback: return the clean string but log warning
        logger.warning("Failed to parse Gemini JSON structure. Raw response (first 500 chars): %s", raw[:500])
        # Last resort: try to extract just the answer value from the malformed JSON
        answer = self._extract_incomplete_json_answer(clean)
        if answer:
            answer = self._clean_answer_text(answer)
            return LLMResponse(
                answer=answer,
                related_topics=[],
                raw_response=raw,
            )
        return LLMResponse(
            answer=clean,
            related_topics=[],
            raw_response=raw,
        )

    @staticmethod
    def _repair_json(text: str) -> str:
        """
        Repair common JSON issues from LLM output.
        - Fixes unescaped literal newlines/tabs inside string literals
        - Fixes invalid single backslashes (e.g. \\sigma, \\pi, \\Delta) into valid escaped backslashes
        """
        valid_escapes = set("\"\\/bfnrtu")

        def fix_string(s: str) -> str:
            out = []
            i = 0
            n = len(s)
            while i < n:
                c = s[i]
                if c == "\n":
                    out.append("\\n")
                    i += 1
                elif c == "\r":
                    out.append("\\r")
                    i += 1
                elif c == "\t":
                    out.append("\\t")
                    i += 1
                elif c == "\\":
                    if i + 1 < n:
                        nxt = s[i + 1]
                        if nxt in valid_escapes:
                            out.append("\\" + nxt)
                            i += 2
                        else:
                            out.append("\\\\" + nxt)
                            i += 2
                    else:
                        out.append("\\\\")
                        i += 1
                else:
                    out.append(c)
                    i += 1
            return "".join(out)

        parts = []
        in_str = False
        cur = []
        i = 0
        n = len(text)
        while i < n:
            c = text[i]
            if c == "\"" and (i == 0 or text[i - 1] != "\\"):
                if in_str:
                    parts.append("\"" + fix_string("".join(cur)) + "\"")
                    cur = []
                    in_str = False
                else:
                    parts.append("".join(cur))
                    cur = []
                    in_str = True
                i += 1
            else:
                cur.append(c)
                i += 1
        if cur:
            if in_str:
                parts.append("\"" + fix_string("".join(cur)) + "\"")
            else:
                parts.append("".join(cur))

        return "".join(parts)

    @staticmethod
    def _clean_answer_text(answer: str) -> str:
        """
        Remove any JSON-like fragments that leaked into the answer text.
        The LLM sometimes embeds the JSON schema keys inside the answer field.
        """
        # If the answer ends with JSON-like content, strip it
        # Look for patterns like: ", "equations": [...], "structures": [...], "related_topics": [...]
        json_leak_patterns = [
            r',\s*"equations"\s*:\s*\[.*$',
            r',\s*"structures"\s*:\s*\[.*$',
            r',\s*"related_topics"\s*:\s*\[.*$',
            r'\}\s*$',  # trailing } from JSON envelope
        ]
        cleaned = answer
        for pattern in json_leak_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.DOTALL)
        
        return cleaned.strip()

    def _build_response_from_dict(self, data: dict, raw: str) -> LLMResponse:
        answer = data.get("answer", "").strip() or _FALLBACK_ANSWER
        topics = data.get("related_topics", [])
        if not isinstance(topics, list):
            topics = []
        topics = [str(t).strip() for t in topics if str(t).strip()][:4]

        # Parse equations array — ONLY keep actual reactions with arrows
        raw_equations = data.get("equations", [])
        equations: list[EquationItem] = []
        if isinstance(raw_equations, list):
            for eq in raw_equations[:10]:  # check more, keep up to 6
                if isinstance(eq, dict) and eq.get("equation"):
                    eq_str = str(eq["equation"]).strip()
                    if self._is_real_reaction(eq_str):
                        equations.append(EquationItem(
                            equation=eq_str,
                            label=str(eq.get("label", "")).strip(),
                        ))
                if len(equations) >= 6:
                    break

        # Fallback: if LLM returned no valid reactions but the answer text
        # contains $$...$$ reaction blocks, extract them automatically
        if not equations:
            equations = self._extract_reactions_from_answer(answer)

        # Parse structures (molecular geometry & hybridisation)
        raw_structures = data.get("structures", [])
        structures: list[MolecularStructureItem] = []
        if isinstance(raw_structures, list):
            for item in raw_structures[:4]:
                if isinstance(item, dict) and item.get("molecule"):
                    try:
                        sn = int(item["steric_number"]) if item.get("steric_number") is not None else None
                    except (ValueError, TypeError):
                        sn = None
                    try:
                        lp = int(item["lone_pairs"]) if item.get("lone_pairs") is not None else None
                    except (ValueError, TypeError):
                        lp = None
                    try:
                        bp = int(item["bond_pairs"]) if item.get("bond_pairs") is not None else None
                    except (ValueError, TypeError):
                        bp = None

                    structures.append(MolecularStructureItem(
                        molecule=str(item["molecule"]).strip(),
                        central_atom=str(item.get("central_atom", "")).strip(),
                        hybridisation=str(item.get("hybridisation", "")).strip(),
                        geometry=str(item.get("geometry", "")).strip(),
                        bond_angles=str(item.get("bond_angles", "")).strip(),
                        steric_number=sn,
                        lone_pairs=lp,
                        bond_pairs=bp,
                        diagram_ascii=str(item.get("diagram_ascii", "")).strip(),
                    ))

        return LLMResponse(
            answer=answer,
            equations=equations,
            structures=structures,
            related_topics=topics,
            raw_response=raw,
        )

    @staticmethod
    def _is_real_reaction(eq_str: str) -> bool:
        """Check if a string represents an actual chemical reaction (has an arrow)."""
        # Must contain a reaction arrow to be considered a real reaction
        reaction_arrows = ['→', '⇌', '⟶', '←', '->', '<->', '=>', '\\rightarrow',
                           '\\longrightarrow', '\\rightleftharpoons']
        return any(arrow in eq_str for arrow in reaction_arrows)

    @staticmethod
    def _extract_reactions_from_answer(answer: str) -> list:
        """Extract $$...$$ blocks from the answer that contain reaction arrows."""
        import re as _re
        pattern = _re.compile(r'\$\$(.+?)\$\$')
        matches = pattern.findall(answer)
        reactions = []
        reaction_arrows = ['→', '⇌', '⟶', '←', '->', '<=>', '=>']
        for match in matches:
            eq_str = match.strip()
            if any(arrow in eq_str for arrow in reaction_arrows):
                reactions.append(EquationItem(
                    equation=eq_str,
                    label="",
                ))
            if len(reactions) >= 6:
                break
        return reactions

    @staticmethod
    def _extract_incomplete_json_answer(clean_text: str) -> str:
        """
        Robustly extracts an answer from an incomplete, malformed, or truncated JSON.
        Handles cases where the string ends before the closing double quote.
        """
        match = re.search(r'"answer"\s*:\s*"', clean_text)
        if not match:
            return ""

        start_idx = match.end()
        result = []
        escaped = False

        for i in range(start_idx, len(clean_text)):
            char = clean_text[i]
            if escaped:
                # Handle common escapes
                if char == 'n':
                    result.append('\n')
                elif char == 't':
                    result.append('\t')
                elif char == 'r':
                    result.append('\r')
                else:
                    result.append(char)
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                # Reached actual closing quote
                break
            else:
                result.append(char)

        return "".join(result).strip()
