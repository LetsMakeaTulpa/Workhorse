from __future__ import annotations
import json
from collections.abc import AsyncIterator
from typing import Any
import httpx
from ..config import get_settings

class FeatherlessError(RuntimeError):
    pass

class FeatherlessProvider:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _headers(self) -> dict[str, str]:
        if not self.settings.featherless_api_key:
            raise FeatherlessError("FEATHERLESS_API_KEY is not configured on the server.")
        return {
            "Authorization": f"Bearer {self.settings.featherless_api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://fieldwork.local",
            "X-Title": "FIELDWORK Research",
        }

    async def list_models(self) -> list[dict[str, Any]]:
        headers = self._headers()
        timeout = httpx.Timeout(self.settings.request_timeout_seconds)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(f"{self.settings.featherless_base_url}/models", headers=headers)
            response.raise_for_status()
            payload = response.json()
        data = payload.get("data", []) if isinstance(payload, dict) else []
        return [item for item in data if isinstance(item, dict) and item.get("id")]

    async def stream_chat(self, model: str, messages: list[dict], temperature: float, max_tokens: int) -> AsyncIterator[str]:
        headers = self._headers()
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        timeout = httpx.Timeout(connect=15.0, read=None, write=30.0, pool=15.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{self.settings.featherless_base_url}/chat/completions",
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    error_text = (await response.aread()).decode("utf-8", errors="replace")[:1500]
                    raise FeatherlessError(f"Featherless returned HTTP {response.status_code}: {error_text}")
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        break
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    choices = chunk.get("choices") or []
                    if choices:
                        content = (choices[0].get("delta") or {}).get("content")
                        if isinstance(content, str) and content:
                            yield content
