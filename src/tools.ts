import type { AppState, Config, SearchResult } from './store';

export const api = (cfg: Config, p: string) => {
  const u = cfg.baseUrl.replace(/\/$/, '') + '/' + p;
  return cfg.proxy ? cfg.proxy.replace(/\/$/, '') + '/' + u : u;
};

export const via = (cfg: Config, u: string) =>
  cfg.proxy ? cfg.proxy.replace(/\/$/, '') + '/' + u : u;

export function hdr(cfg: Config, extra: Record<string, string> = {}) {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (cfg.key) h['Authorization'] = 'Bearer ' + cfg.key;
  return h;
}

export class NetErr extends Error {
  net = true;
  constructor(m: string) { super(m); this.name = 'NetErr'; }
}

export const isNet = (e: unknown) => {
  if (!e) return false;
  const err = e as { net?: boolean; name?: string; message?: string };
  return err.net || err.name === 'TypeError' || /Failed to fetch|NetworkError|load failed/i.test(err.message || '');
};

export async function netFetch(cfg: Config, url: string, opts: RequestInit = {}) {
  const target = via(cfg, url);
  let r: Response;
  try {
    r = await fetch(target, opts);
  } catch (e) {
    if (!cfg.proxy) throw new NetErr('blocked: cannot reach ' + new URL(url).hostname);
    throw new NetErr('proxy unreachable at ' + cfg.proxy);
  }
  if (!r.ok && r.status === 0) throw new NetErr('empty response from ' + new URL(url).hostname);
  return r;
}

export function countTok(t: string) { return Math.ceil((t || '').length / 4); }

export async function llm(cfg: Config, model: string, msgs: unknown[], opt: { temp?: number; max?: number } = {}) {
  const r = await netFetch(cfg, api(cfg, 'chat/completions'), {
    method: 'POST',
    headers: hdr(cfg),
    body: JSON.stringify({
      model,
      messages: msgs,
      stream: false,
      temperature: opt.temp ?? 0.3,
      max_tokens: opt.max ?? 900,
      top_p: 1
    })
  });
  if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return (j.choices?.[0]?.message?.content || '') as string;
}

export function parseJSON(t: string): unknown {
  if (!t) return null;
  const f = t.replace(/^```(?:json)?/m, '').replace(/```$/m, '');
  try { return JSON.parse(f); } catch {}
  const m = f.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// Search providers
export async function searchDDG(q: string): Promise<SearchResult[]> {
  try {
    const r = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(q) + '&format=json&no_html=1&skip_disambig=1');
    const j = await r.json();
    const results: SearchResult[] = [];
    if (j.AbstractText) results.push({ title: j.Heading || q, url: j.AbstractURL || '', text: j.AbstractText });
    (j.RelatedTopics || []).forEach((t: { Text?: string; FirstURL?: string }) => {
      if (t.Text && t.FirstURL) results.push({ title: t.Text.slice(0, 80), url: t.FirstURL, text: t.Text });
    });
    return results.slice(0, 8);
  } catch { return []; }
}

export async function searchExa(q: string, key: string): Promise<SearchResult[]> {
  if (!key) return [];
  try {
    const r = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ query: q, numResults: 8, contents: { text: { maxCharacters: 500 } } })
    });
    const j = await r.json();
    return (j.results || []).map((x: { title?: string; url: string; text?: string }) => ({
      title: x.title, url: x.url, text: x.text?.slice(0, 500)
    }));
  } catch { return []; }
}

export async function searchTavily(q: string, key: string): Promise<SearchResult[]> {
  if (!key) return [];
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: q, max_results: 8, include_answer: false })
    });
    const j = await r.json();
    return (j.results || []).map((x: { title?: string; url: string; content?: string }) => ({
      title: x.title, url: x.url, text: x.content?.slice(0, 500)
    }));
  } catch { return []; }
}

export async function searchBrave(q: string, key: string): Promise<SearchResult[]> {
  if (!key) return [];
  try {
    const r = await fetch('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(q), {
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': key }
    });
    const j = await r.json();
    return (j.web?.results || []).map((x: { title?: string; url: string; description?: string }) => ({
      title: x.title, url: x.url, text: x.description?.slice(0, 500)
    }));
  } catch { return []; }
}

export async function searchGithub(q: string, key?: string): Promise<SearchResult[]> {
  try {
    const h: Record<string, string> = { 'Accept': 'application/vnd.github+json' };
    if (key) h['Authorization'] = 'Bearer ' + key;
    const r = await fetch('https://api.github.com/search/repositories?per_page=8&q=' + encodeURIComponent(q), { headers: h });
    const j = await r.json();
    return (j.items || []).map((x: { full_name: string; html_url: string; description?: string; stargazers_count: number }) => ({
      title: x.full_name + ' ★' + x.stargazers_count,
      url: x.html_url,
      text: x.description
    }));
  } catch { return []; }
}

export async function searchWiki(q: string): Promise<SearchResult[]> {
  try {
    const r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(q));
    if (!r.ok) return [];
    const j = await r.json();
    if (j.title) return [{ title: j.title, url: j.content_urls?.desktop?.page || '', text: j.extract }];
    return [];
  } catch { return []; }
}

export async function fetchAll(state: AppState, queries: string[]): Promise<SearchResult[]> {
  const { cfg } = state;
  const promises: Promise<SearchResult[]>[] = [];
  const q = queries.join(' ');

  if (cfg.providers.ddg) promises.push(searchDDG(q));
  if (cfg.providers.exa && cfg.keys.exa) promises.push(searchExa(q, cfg.keys.exa));
  if (cfg.providers.tavily && cfg.keys.tavily) promises.push(searchTavily(q, cfg.keys.tavily));
  if (cfg.providers.brave && cfg.keys.brave) promises.push(searchBrave(q, cfg.keys.brave));
  if (cfg.providers.github) promises.push(searchGithub(q, cfg.keys.github));
  if (cfg.providers.wiki) promises.push(searchWiki(q));

  const results = await Promise.allSettled(promises);
  const all: SearchResult[] = [];
  results.forEach(r => { if (r.status === 'fulfilled') all.push(...r.value); });

  // Deduplicate by URL
  const seen = new Set<string>();
  return all.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  }).slice(0, cfg.topK || 6);
}

// Tools
export interface ToolResult {
  name: string;
  sum: string;
  ok: boolean;
  output?: string;
}

export const TOOLS: Record<string, { desc: string; run: (args: Record<string, string>, state: AppState, dispatch: (action: any) => void) => Promise<string> }> = {
  web_search: {
    desc: 'Search the web. args {query}',
    async run(a, state) {
      const q = String(a.query || '').trim();
      if (!q) throw new Error('query required');
      const hits = await fetchAll(state, [q]);
      if (!hits.length) return 'no results';
      return hits.slice(0, 8).map((r, i) => '[' + (i + 1) + '] ' + (r.title || '') + ' ' + r.url + '\n' + (r.text || '').slice(0, 500)).join('\n\n');
    }
  },
  read_page: {
    desc: 'Fetch a URL as markdown text. args {url}',
    async run(a, state) {
      const u = String(a.url || '');
      if (!/^https?:/.test(u)) throw new Error('bad url');
      const r = await netFetch(state.cfg, 'https://r.jina.ai/' + u);
      return (await r.text()).slice(0, 6000);
    }
  },
  github_search: {
    desc: 'Search GitHub repositories. args {query}',
    async run(a, state) {
      const q = String(a.query || '');
      if (!q) throw new Error('query required');
      const r = await netFetch(state.cfg, 'https://api.github.com/search/repositories?per_page=8&q=' + encodeURIComponent(q),
        { headers: { Accept: 'application/vnd.github+json', ...(state.cfg.keys.github ? { Authorization: 'Bearer ' + state.cfg.keys.github } : {}) } });
      const j = await r.json();
      return (j.items || []).map((x: { full_name: string; stargazers_count: number; description?: string }) => x.full_name + ' stars:' + x.stargazers_count + ' - ' + (x.description || '')).join('\n') || 'none';
    }
  },
  save_memory: {
    desc: 'Persist a fact about the user. args {key,value}',
    async run(a, _state, dispatch) {
      if (!a.key) throw new Error('key required');
      dispatch({ type: 'ADD_MEM', entry: { id: Math.random().toString(36).slice(2, 10), k: String(a.key).slice(0, 80), v: String(a.value || '').slice(0, 600), src: 'agent', ts: Date.now() } });
      return 'saved';
    }
  },
  recall_memory: {
    desc: 'Recall stored facts. args {query}',
    async run(a, state) {
      const q = String(a.query || '').toLowerCase();
      const hit = state.mem.filter(m => !q || (m.k + m.v).toLowerCase().includes(q)).slice(0, 12);
      return hit.length ? hit.map(m => m.k + ': ' + m.v).join('\n') : 'nothing stored';
    }
  },
  run_code: {
    desc: 'Run JavaScript in a sandbox, returns console output. args {code}',
    async run(a) {
      const logs: string[] = [];
      const fake = {
        log: (...x: unknown[]) => logs.push(x.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ')),
        error: (...x: unknown[]) => logs.push('ERR ' + x.join(' ')),
        warn: (...x: unknown[]) => logs.push('WARN ' + x.join(' '))
      };
      try {
        const fn = new Function('console', 'return (async()=>{' + String(a.code || '') + '})()');
        const out = await fn(fake);
        if (out !== undefined) logs.push('=> ' + JSON.stringify(out));
      } catch (e: unknown) { logs.push('THROW ' + (e as Error).message); }
      return (logs.join('\n') || '(no output)').slice(0, 4000);
    }
  },
  generate_image: {
    desc: 'Create an image from a prompt, returns a URL. args {prompt}',
    async run(a) {
      const p = encodeURIComponent(String(a.prompt || 'abstract'));
      return 'https://image.pollinations.ai/prompt/' + p + '?width=1024&height=1024&nologo=true';
    }
  }
};

export const TOOL_DOCS = Object.entries(TOOLS).map(([k, v]) => '- ' + k + ': ' + v.desc).join('\n');

export async function runTool(name: string, args: Record<string, string>, state: AppState, dispatch: (action: any) => void): Promise<string> {
  const t = TOOLS[name];
  if (!t) return 'unknown tool ' + name;
  try { return await t.run(args, state, dispatch); }
  catch (e: unknown) { return 'TOOL ERROR ' + (e as Error).message; }
}

export const MODES: Record<string, { label: string; ops: string[] }> = {
  general: { label: 'general', ops: [] },
  academic: { label: 'academic', ops: ['site:arxiv.org', 'site:scholar.google.com', 'site:pubmed.ncbi.nlm.nih.gov'] },
  news: { label: 'news', ops: ['site:reuters.com', 'site:apnews.com', 'site:bbc.com'] },
  code: { label: 'code', ops: ['site:github.com', 'site:stackoverflow.com'] },
  social: { label: 'social', ops: ['site:reddit.com', 'site:news.ycombinator.com'] }
};

export const DORKS: [string, string][] = [
  ['site:github.com ', 'github'],
  ['site:reddit.com ', 'reddit'],
  ['filetype:pdf ', 'pdf'],
  ['intitle:index.of ', 'index of'],
  ['site:stackoverflow.com ', 'stack'],
  ['site:arxiv.org ', 'arxiv'],
  ['"', 'exact'],
  ['inurl:api ', 'inurl api'],
  ['-site:pinterest.com ', 'no pinterest'],
  ['after:2025-01-01 ', 'recent']
];
