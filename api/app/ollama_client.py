"""Minimal async client for the Ollama REST API (version, tags, ps, show, streaming chat)."""
import json
from typing import AsyncIterator, Optional

import httpx


class OllamaError(Exception):
    """Ollama unreachable or returned an error. `status` is the HTTP status when there was one."""

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


class OllamaClient:
    def __init__(self, base_url: str, timeout: float = 600, transport: Optional[httpx.AsyncBaseTransport] = None):
        # Short connect timeout so health checks fail fast; long read timeout for model loads and long answers.
        self._client = httpx.AsyncClient(base_url=base_url, transport=transport,
                                         timeout=httpx.Timeout(timeout, connect=5.0))

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get(self, path: str) -> dict:
        try:
            r = await self._client.get(path, timeout=10.0)
        except httpx.HTTPError as e:
            raise OllamaError(f"Ollama not reachable: {e.__class__.__name__}") from e
        if r.status_code != 200:
            raise OllamaError(f"Ollama {path} returned HTTP {r.status_code}", r.status_code)
        return r.json()

    async def version(self) -> str:
        return (await self._get("/api/version")).get("version", "unknown")

    async def tags(self) -> list:
        return (await self._get("/api/tags")).get("models", [])

    async def ps(self) -> list:
        return (await self._get("/api/ps")).get("models", [])

    async def show(self, model: str) -> dict:
        try:
            r = await self._client.post("/api/show", json={"model": model}, timeout=15.0)
        except httpx.HTTPError as e:
            raise OllamaError(f"Ollama not reachable: {e.__class__.__name__}") from e
        if r.status_code != 200:
            raise OllamaError(f"Model '{model}' not available (HTTP {r.status_code})", r.status_code)
        return r.json()

    async def chat_stream(self, payload: dict) -> AsyncIterator[dict]:
        """POST /api/chat with stream=true and yield each NDJSON chunk as a dict."""
        try:
            async with self._client.stream("POST", "/api/chat", json={**payload, "stream": True}) as r:
                if r.status_code != 200:
                    body = (await r.aread()).decode("utf-8", "replace")
                    try:
                        detail = json.loads(body).get("error", body)
                    except ValueError:
                        detail = body
                    raise OllamaError(f"Ollama chat failed (HTTP {r.status_code}): {detail[:300]}", r.status_code)
                async for line in r.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                    except ValueError:
                        continue
                    if chunk.get("error"):
                        raise OllamaError(f"Ollama error: {str(chunk['error'])[:300]}")
                    yield chunk
        except httpx.HTTPError as e:
            raise OllamaError(f"Ollama connection lost: {e.__class__.__name__}") from e
