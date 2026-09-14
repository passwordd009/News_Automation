"""LLM access, behind an interface.

Nothing outside this package may import a provider directly. Swapping Ollama
for Claude, OpenAI or Gemini later means adding a class here and changing
``LLM_PROVIDER`` — no other module changes.
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod

import requests

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


class LLMError(RuntimeError):
    """The model could not be reached or returned nothing usable."""


class LLMClient(ABC):
    """Minimal surface every provider must offer."""

    name: str = "base"

    @abstractmethod
    def generate(self, prompt: str, *, system: str | None = None) -> str:
        """Return the model's raw text response."""

    def is_available(self) -> bool:
        """Whether the provider can be reached right now."""
        return True


class OllamaClient(LLMClient):
    """Local Ollama. Free, offline, and the default."""

    name = "ollama"

    def __init__(self, settings: Settings | None = None) -> None:
        settings = settings or get_settings()
        self.base_url = settings.ollama_url.rstrip("/")
        self.model = settings.ollama_model
        self.timeout = settings.llm_timeout
        self.temperature = settings.llm_temperature
        self.auth_token = settings.ollama_auth_token

    @property
    def _headers(self) -> dict[str, str]:
        """Ollama has no authentication of its own.

        A self-hosted instance the worker reaches over the internet must sit
        behind a proxy that requires this token, or anyone who finds the port
        can use the model. Empty when talking to localhost, where there is
        nothing to protect against.
        """
        if not self.auth_token:
            return {}
        return {"Authorization": f"Bearer {self.auth_token}"}

    def generate(self, prompt: str, *, system: str | None = None) -> str:
        payload: dict = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            # Ask Ollama itself to constrain output to JSON. Belt and braces:
            # the response is still validated with Pydantic.
            "format": "json",
            "options": {"temperature": self.temperature},
        }
        if system:
            payload["system"] = system

        try:
            response = requests.post(
                f"{self.base_url}/api/generate",
                json=payload,
                timeout=self.timeout,
                headers=self._headers,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise LLMError(f"Could not reach Ollama at {self.base_url}: {exc}") from exc

        try:
            body = response.json()
        except json.JSONDecodeError as exc:
            raise LLMError(f"Ollama returned a non-JSON envelope: {exc}") from exc

        text = (body.get("response") or "").strip()
        if not text:
            raise LLMError("Ollama returned an empty response.")
        return text

    def is_available(self) -> bool:
        """Check the daemon is up and the configured model is pulled."""
        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=10, headers=self._headers)
            if response.status_code in (401, 403):
                logger.warning(
                    "Ollama at %s rejected the credentials. Check OLLAMA_AUTH_TOKEN "
                    "matches what the proxy expects.",
                    self.base_url,
                )
                return False
            response.raise_for_status()
            models = {m.get("name", "") for m in response.json().get("models", [])}
        except (requests.RequestException, json.JSONDecodeError, AttributeError) as exc:
            logger.warning("Ollama is not reachable at %s: %s", self.base_url, exc)
            return False

        # Tags carry an explicit tag ("llama3.1:latest"); accept a bare name too.
        if any(m == self.model or m.split(":")[0] == self.model.split(":")[0] for m in models):
            return True

        logger.warning(
            "Ollama is running but model %r is not pulled. Try: ollama pull %s",
            self.model,
            self.model,
        )
        return False


class StubLLMClient(LLMClient):
    """Returns a fixed response. For tests and offline dry runs."""

    name = "stub"

    def __init__(self, response: str = "{}") -> None:
        self.response = response
        self.calls: list[str] = []

    def generate(self, prompt: str, *, system: str | None = None) -> str:
        self.calls.append(prompt)
        return self.response


_PROVIDERS: dict[str, type[LLMClient]] = {
    "ollama": OllamaClient,
}


def get_llm_client(settings: Settings | None = None) -> LLMClient:
    """Build the configured provider."""
    settings = settings or get_settings()
    provider = settings.llm_provider.lower().strip()

    client_class = _PROVIDERS.get(provider)
    if client_class is None:
        raise LLMError(
            f"Unknown LLM_PROVIDER {provider!r}. Available: {', '.join(sorted(_PROVIDERS))}."
        )
    return client_class(settings)
