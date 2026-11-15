from __future__ import annotations
import asyncio
import json
import re
from typing import Any
from ..config import get_settings
from ..prompts import build_messages
from ..providers.featherless import FeatherlessProvider
from ..providers.search import deduplicate_and_rank, run_search


async def _plan_queries(question: str, search_query: str, model: str) -> list[str]:
    """Ask the selected model for bounded query expansions; fall back to the literal query."""
    base = (search_query or question).strip()
    try:
        raw = await FeatherlessProvider().complete_chat(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a search query planner, not an answer generator. "
                        "Return only valid JSON: {\"queries\":[\"...\"]}. "
                        "Create at most three distinct, useful search queries for the user's research question. "
                        "Preserve explicit site:, filetype:, intitle:, inurl:, quoted phrase, exclusion, and date operators. "
                        "Do not invent facts or add unsupported entities. Do not answer the question."
                    ),
                },
                {
                    "role": "user",
                    "content": "Research question: " + question + "\nSearch query and dork rules: " + base,
                },
            ],
            temperature=0.1,
            max_tokens=400,
        )
        match = re.search(r"\{[\s\S]*\}", raw)
        payload = json.loads(match.group(0)) if match else {}
        proposed = payload.get("queries", []) if isinstance(payload, dict) else []
        valid = [q.strip() for q in proposed if isinstance(q, str) and q.strip()][:3]
        return list(dict.fromkeys([base, *valid]))[:4]
    except Exception:
        return [base]


async def prepare_research_turn(
    question: str,
    history: list[dict],
    providers: list[str],
    search_enabled: bool,
    depth: str,
    category: str | None,
    time_range: str | None,
    system_prompt: str | None,
    search_query: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    if search_enabled and providers:
        settings = get_settings()
        selected_model = (model or settings.featherless_model_id).strip()
        queries = await _plan_queries(question, search_query or question, selected_model)
        outcomes = await asyncio.gather(
            *(
                run_search(query, providers=providers, depth=depth, category=category, time_range=time_range)
                for query in queries
            ),
            return_exceptions=True,
        )
        result_sets: list[tuple[str, list[dict[str, Any]]]] = []
        provider_status: list[dict[str, str]] = []
        for query, outcome in zip(queries, outcomes):
            if isinstance(outcome, Exception):
                provider_status.append({"provider": "query planner", "status": "error", "detail": str(outcome)[:240]})
                continue
            for item in outcome.get("providers", []):
                provider_status.append({
                    "provider": item.get("provider", "unknown"),
                    "status": item.get("status", "unknown"),
                    "detail": query[:90] + " · " + item.get("detail", ""),
                })
            grouped: dict[str, list[dict[str, Any]]] = {}
            for source in outcome.get("results", []):
                for provider in source.get("providers") or [source.get("provider", "unknown")]:
                    grouped.setdefault(provider, []).append(source)
            result_sets.extend(grouped.items())
        sources = deduplicate_and_rank(result_sets, limit=32 if depth == "deep" else 20)
        result = {"results": sources, "providers": provider_status, "search_plan": queries}
    else:
        result = {"results": [], "providers": [], "search_plan": []}

    messages = build_messages(
        history=history,
        question=question,
        sources=result["results"],
        system_prompt=system_prompt,
    )
    return {
        "messages": messages,
        "sources": result["results"],
        "providers": result["providers"],
        "search_plan": result["search_plan"],
    }
