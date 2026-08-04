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
from typing import List

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
class LLMResponse:
    """Structured output from the Gemini LLM call."""

    answer: str
    equations: List[EquationItem] = field(default_factory=list)
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
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        before_sleep=before_sleep_log(logger, 20),  # 20 = logging.WARNING
        reraise=True,
    )
    def _call_gemini(self, prompt: str) -> str:
        """Make the API call with retry logic. Returns raw text."""
        logger.info("Calling Gemini API (model: %s).", self._model_name)
        response = self._model.generate_content(prompt)
        raw_text = response.text
        logger.info("Gemini response received (%d chars).", len(raw_text))
        return raw_text

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

        # Try 1: Direct JSON load
        try:
            data = json.loads(clean)
            return self._build_response_from_dict(data, raw)
        except Exception:
            pass

        # Try 2: Extract JSON object block using regex
        try:
            match = re.search(r"(\{.*\})", clean, re.DOTALL)
            if match:
                data = json.loads(match.group(1))
                return self._build_response_from_dict(data, raw)
        except Exception:
            pass

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
        logger.warning("Failed to parse Gemini JSON structure. Raw response: %s", raw)
        return LLMResponse(
            answer=clean,
            related_topics=[],
            raw_response=raw,
        )

    def _build_response_from_dict(self, data: dict, raw: str) -> LLMResponse:
        answer = data.get("answer", "").strip() or _FALLBACK_ANSWER
        topics = data.get("related_topics", [])
        if not isinstance(topics, list):
            topics = []
        topics = [str(t).strip() for t in topics if str(t).strip()][:4]

        # Parse equations array
        raw_equations = data.get("equations", [])
        equations: list[EquationItem] = []
        if isinstance(raw_equations, list):
            for eq in raw_equations[:6]:
                if isinstance(eq, dict) and eq.get("equation"):
                    equations.append(EquationItem(
                        equation=str(eq["equation"]).strip(),
                        label=str(eq.get("label", "")).strip(),
                    ))

        return LLMResponse(
            answer=answer,
            equations=equations,
            related_topics=topics,
            raw_response=raw,
        )

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
