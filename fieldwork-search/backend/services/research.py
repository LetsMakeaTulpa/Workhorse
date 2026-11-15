from __future__ import annotations
from typing import Any
from ..prompts import build_messages
from ..providers.search import run_search

async def prepare_research_turn(question: str, history: list[dict], providers: list[str], search_enabled: bool, depth: str, category: str | None, time_range: str | None, system_prompt: str | None) -> dict[str, Any]:
    if search_enabled and providers:
        result = await run_search(question, providers=providers, depth=depth, category=category, time_range=time_range)
    else:
        result = {"results": [], "providers": []}
    messages = build_messages(history=history, question=question, sources=result["results"], system_prompt=system_prompt)
    return {"messages": messages, "sources": result["results"], "providers": result["providers"]}
