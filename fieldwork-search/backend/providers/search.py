from __future__ import annotations
import asyncio
import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import httpx
from ..config import get_settings

TRACKING_KEYS = {"fbclid", "gclid", "mc_cid", "mc_eid"}
PROVIDER_WEIGHTS = {"exa": 1.25, "searxng": 1.0, "brave": 1.1, "tavily": 1.1, "serper": 1.0}

def canonical_url(value: str) -> str:
    try:
        parts = urlsplit(value.strip())
        if parts.scheme not in {"http", "https"} or not parts.netloc:
            return value.strip()
        query = [
            (key, val) for key, val in parse_qsl(parts.query, keep_blank_values=True)
            if key.lower() not in TRACKING_KEYS and not key.lower().startswith("utm_")
        ]
        path = re.sub(r"/+$", "", parts.path) or "/"
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, urlencode(query), ""))
    except Exception:
        return value.strip()

def _normalize(item: dict[str, Any], provider: str) -> dict[str, Any] | None:
    url = item.get("url") or item.get("link")
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        return None
    snippets = item.get("highlights") or item.get("content") or item.get("snippet") or item.get("description") or ""
    snippet = " ".join(str(part) for part in snippets if part) if isinstance(snippets, list) else str(snippets)
    return {
        "title": str(item.get("title") or item.get("name") or url)[:500],
        "url": url,
        "domain": urlsplit(url).netloc.lower(),
        "snippet": snippet[:5000],
        "published_at": item.get("publishedDate") or item.get("published_date") or item.get("published"),
        "provider": provider,
        "providers": [provider],
        "provider_score": float(item.get("score") or 0),
    }

async def _exa_search(query: str, depth: str, category: str | None, timeout_seconds: float) -> list[dict[str, Any]]:
    settings = get_settings()
    if not settings.exa_api_key:
        raise RuntimeError("EXA_API_KEY is not configured.")
    body: dict[str, Any] = {
        "query": query,
        "type": "deep" if depth == "deep" else "auto",
        "numResults": 12 if depth == "deep" else 8,
        "contents": {"highlights": True},
    }
    allowed_categories = {"company", "research paper", "news", "tweet", "personal site", "financial report", "people"}
    if category in allowed_categories:
        body["category"] = category
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(
            "https://api.exa.ai/search",
            headers={"x-api-key": settings.exa_api_key, "Content-Type": "application/json"},
            json=body,
        )
        response.raise_for_status()
        payload = response.json()
    return [value for value in (_normalize(item, "exa") for item in (payload.get("results") or [])) if value]

async def _searxng_search(query: str, depth: str, category: str | None, time_range: str | None, timeout_seconds: float) -> list[dict[str, Any]]:
    settings = get_settings()
    if not settings.searxng_url:
        raise RuntimeError("SEARXNG_URL is not configured.")
    endpoint = settings.searxng_url if settings.searxng_url.endswith("/search") else settings.searxng_url + "/search"
    params: dict[str, Any] = {"q": query, "format": "json", "pageno": 1, "safesearch": 0}
    if category in {"general", "it", "science", "files", "social media", "news"}:
        params["categories"] = category
    if time_range in {"day", "month", "year"}:
        params["time_range"] = time_range
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.get(endpoint, params=params)
        response.raise_for_status()
        payload = response.json()
    return [value for value in (_normalize(item, "searxng") for item in (payload.get("results") or [])) if value]

async def _brave_search(query: str, depth: str, timeout_seconds: float) -> list[dict[str, Any]]:
    settings = get_settings()
    if not settings.brave_api_key:
        raise RuntimeError("BRAVE_API_KEY is not configured.")
    params = {"q": query, "count": 20 if depth == "deep" else 10}
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.get(
            "https://api.search.brave.com/res/v1/web/search",
            headers={"X-Subscription-Token": settings.brave_api_key, "Accept": "application/json"},
            params=params,
        )
        response.raise_for_status()
        payload = response.json()
    items = (payload.get("web") or {}).get("results") or []
    return [value for value in (_normalize(item, "brave") for item in items) if value]


async def _tavily_search(query: str, depth: str, timeout_seconds: float) -> list[dict[str, Any]]:
    settings = get_settings()
    if not settings.tavily_api_key:
        raise RuntimeError("TAVILY_API_KEY is not configured.")
    body = {
        "api_key": settings.tavily_api_key,
        "query": query,
        "search_depth": "advanced" if depth == "deep" else "basic",
        "max_results": 20 if depth == "deep" else 10,
        "include_answer": False,
        "include_raw_content": False,
    }
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post("https://api.tavily.com/search", json=body)
        response.raise_for_status()
        payload = response.json()
    return [value for value in (_normalize(item, "tavily") for item in (payload.get("results") or [])) if value]


async def _serper_search(query: str, depth: str, timeout_seconds: float) -> list[dict[str, Any]]:
    settings = get_settings()
    if not settings.serper_api_key:
        raise RuntimeError("SERPER_API_KEY is not configured.")
    body = {"q": query, "num": 20 if depth == "deep" else 10}
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": settings.serper_api_key, "Content-Type": "application/json"},
            json=body,
        )
        response.raise_for_status()
        payload = response.json()
    return [value for value in (_normalize(item, "serper") for item in (payload.get("organic") or [])) if value]


def deduplicate_and_rank(result_sets: list[tuple[str, list[dict[str, Any]]]], limit: int = 24) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for provider, items in result_sets:
        weight = PROVIDER_WEIGHTS.get(provider, 1.0)
        for rank, item in enumerate(items, start=1):
            key = canonical_url(item["url"])
            if key not in merged:
                merged[key] = {**item, "providers": list(item.get("providers") or [provider]), "rrf_score": 0.0}
            else:
                current = merged[key]
                if provider not in current["providers"]:
                    current["providers"].append(provider)
                if not current.get("snippet") and item.get("snippet"):
                    current["snippet"] = item["snippet"]
                if not current.get("published_at") and item.get("published_at"):
                    current["published_at"] = item["published_at"]
            merged[key]["rrf_score"] += weight / (60 + rank)
    ranked = sorted(merged.values(), key=lambda item: (item["rrf_score"], item.get("provider_score", 0)), reverse=True)
    for item in ranked:
        item.pop("provider_score", None)
    return ranked[:limit]

async def run_search(query: str, providers: list[str], depth: str = "standard", category: str | None = None, time_range: str | None = None) -> dict[str, Any]:
    settings = get_settings()
    timeout = settings.request_timeout_seconds
    tasks: list[tuple[str, Any]] = []
    if "exa" in providers:
        tasks.append(("exa", _exa_search(query, depth, category, timeout)))
    if "searxng" in providers:
        tasks.append(("searxng", _searxng_search(query, depth, category, time_range, timeout)))
    if "brave" in providers:
        tasks.append(("brave", _brave_search(query, depth, timeout)))
    if "tavily" in providers:
        tasks.append(("tavily", _tavily_search(query, depth, timeout)))
    if "serper" in providers:
        tasks.append(("serper", _serper_search(query, depth, timeout)))
    outcomes = await asyncio.gather(*(task for _, task in tasks), return_exceptions=True)
    result_sets: list[tuple[str, list[dict[str, Any]]]] = []
    statuses: list[dict[str, str]] = []
    for (provider, _), outcome in zip(tasks, outcomes):
        if isinstance(outcome, Exception):
            statuses.append({"provider": provider, "status": "error", "detail": str(outcome)[:300]})
        else:
            result_sets.append((provider, outcome))
            statuses.append({"provider": provider, "status": "ok", "detail": f"{len(outcome)} results"})
    return {
        "results": deduplicate_and_rank(result_sets, limit=32 if depth == "deep" else 16),
        "providers": statuses,
    }
