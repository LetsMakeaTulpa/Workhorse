import asyncio

from backend.services import research
from backend.providers.search import _normalize


def test_query_planner_uses_selected_model_and_preserves_base_dorks(monkeypatch):
    class FakeProvider:
        async def complete_chat(self, **kwargs):
            assert kwargs["model"] == "vendor/model-x"
            return '{"queries":["expanded research query","independent verification query"]}'

    monkeypatch.setattr(research, "FeatherlessProvider", lambda: FakeProvider())
    queries = asyncio.run(
        research._plan_queries(
            "Who documented the event?",
            'site:archives.gov "event report"',
            "vendor/model-x",
        )
    )
    assert queries[0] == 'site:archives.gov "event report"'
    assert "expanded research query" in queries
    assert len(queries) <= 4


def test_query_planner_falls_back_to_literal_query_on_model_error(monkeypatch):
    class BrokenProvider:
        async def complete_chat(self, **kwargs):
            raise RuntimeError("model unavailable")

    monkeypatch.setattr(research, "FeatherlessProvider", lambda: BrokenProvider())
    queries = asyncio.run(research._plan_queries("Question", "site:example.org Question", "model"))
    assert queries == ["site:example.org Question"]


def test_search_normalizer_accepts_brave_description_snippets():
    item = _normalize(
        {"title": "Example result", "url": "https://example.org/page", "description": "Useful excerpt"},
        "brave",
    )
    assert item is not None
    assert item["snippet"] == "Useful excerpt"
    assert item["provider"] == "brave"
