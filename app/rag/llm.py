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
class LLMResponse:
    """Structured output from the Gemini LLM call."""

    answer: str
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
        max_output_tokens: int = 1024,
        temperature: float = 0.2,
    ) -> None:
        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY is missing. "
                "Set it in your .env file before starting the application."
            )
        genai.configure(api_key=api_key)
        self._model_name = model_name

        generation_config = genai.GenerationConfig(
            max_output_tokens=max_output_tokens,
            temperature=temperature,          # low temp = less creative = less hallucination
            response_mime_type="application/json",  # ask Gemini to return JSON
        )

        self._model = genai.GenerativeModel(
            model_name=model_name,
            generation_config=generation_config,
        )
        logger.info("Gemini client initialised. Model: %s", model_name)

    # ── Public API ────────────────────────────────────────────────────────────

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

    @property
    def model_name(self) -> str:
        return self._model_name

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
        try:
            # Strip potential markdown fences Gemini occasionally adds
            clean = re.sub(r"```(?:json)?|```", "", raw).strip()
            data = json.loads(clean)

            answer = data.get("answer", "").strip() or _FALLBACK_ANSWER
            topics = data.get("related_topics", [])

            # Ensure topics is a list of strings
            if not isinstance(topics, list):
                topics = []
            topics = [str(t).strip() for t in topics if str(t).strip()][:4]

            return LLMResponse(
                answer=answer,
                related_topics=topics,
                raw_response=raw,
            )

        except (json.JSONDecodeError, AttributeError) as exc:
            logger.warning("Failed to parse Gemini JSON response: %s", exc)
            # Return the raw text as the answer rather than losing it
            return LLMResponse(
                answer=raw.strip() if raw.strip() else _FALLBACK_ANSWER,
                related_topics=[],
                raw_response=raw,
            )
