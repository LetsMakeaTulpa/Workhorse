---
name: search-orchestration
description: Use when building search-engine adapters, multi-engine queries, query expansion, dork execution, ranking, result normalization, or engine-by-engine views.
---

# Search-engine and dork orchestration

## Design
Search providers are retrieval adapters, not interchangeable black boxes. Each adapter must declare its capabilities, supported operators, result limits, rate-limit behavior, and configuration requirements.

Potential adapters include Exa, SearXNG, Brave, Tavily, Serper, and specialist sources such as Shodan. Only expose providers that are actually configured and implemented. Do not imply a provider is active merely because it appears in the selector.

## Search flow
1. Accept the user question and active saved configuration.
2. Ask the selected LLM to produce a structured search plan.
3. Validate and bound the plan server-side.
4. Execute query variants against enabled providers.
5. Apply provider-specific dorks/operators only where supported.
6. Normalize results while preserving original provider, query, rank, URL, title, snippet, timestamp, and provider metadata.
7. Deduplicate by canonical URL and content fingerprint without erasing provider provenance.
8. Rank with a documented method such as weighted Reciprocal Rank Fusion.
9. Return both a unified ranked view and an engine-by-engine view.
10. Pass retrieved evidence—not just snippets—to synthesis when page fetching is enabled.

## Dorks
- Treat dorks as reusable, composable search recipes, not arbitrary strings hidden in prompts.
- Support named recipes with description, provider compatibility, query template, parameters, and safety/validation rules.
- Provide a visual builder for operators such as site:, filetype:, intitle:, inurl:, quoted phrases, exclusions, and date constraints where the selected engine supports them.
- Allow users to save a single dork and a named combination of dorks.
- Preserve specialist profiles such as Shodan as explicit provider-specific search profiles; do not send Shodan syntax to unrelated engines.
- Show the final expanded query for each provider before or during execution.

## Reliability
- Run independent provider calls concurrently with timeouts and bounded retries.
- Partial success is valid and must be displayed as partial, with failed providers identified.
- Respect rate limits and provider terms.
- Cache only when the cache policy and freshness are visible.
- Never invent search results or silently claim an engine was queried.

## Acceptance tests
- Query planning output is schema-validated.
- Disabled providers are never called.
- Provider-specific syntax is routed only to compatible providers.
- Duplicate URLs collapse while provider provenance remains inspectable.
- Ranking is deterministic for fixed inputs.
- Partial provider failures preserve successful results.
