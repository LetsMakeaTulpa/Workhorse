import type { AppState, Config, SearchResult, Message, Chat } from './store';
import { uid } from './store';

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

export function parseJSON(t: string): any {
  if (!t) return null;
  const f = t.replace(/^```(?:json)?/m, '').replace(/```$/m, '');
  try { return JSON.parse(f); } catch {}
  const m = f.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// ============ Streaming ============
export async function stream(
  cfg: Config,
  chat: { model: string },
  messages: unknown[],
  onDelta: (chunk: string) => void,
  signal?: AbortSignal
): Promise<number> {
  const r = await netFetch(cfg, api(cfg, 'chat/completions'), {
    method: 'POST',
    headers: hdr(cfg),
    signal,
    body: JSON.stringify({
      model: chat.model || cfg.model,
      messages,
      stream: true,
      temperature: +cfg.temp,
      max_tokens: +cfg.maxTokens,
      top_p: +cfg.topP
    })
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(r.status + ' ' + t.slice(0, 400));
  }
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const d = l.slice(5).trim();
      if (d === '[DONE]') return Math.ceil(n * 0.75);
      try {
        const j = JSON.parse(d);
        const t = j.choices?.[0]?.delta?.content;
        if (t) { n++; onDelta(t); }
      } catch {}
    }
  }
  return Math.ceil(n * 0.75);
}

// ============ Search providers ============
export async function searchOne(cfg: Config, provider: string, q: string): Promise<SearchResult[]> {
  const k = cfg.keys;
  if (provider === 'exa') {
    if (!k.exa) throw new Error('add exa key');
    const r = await netFetch(cfg, 'https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': k.exa },
      body: JSON.stringify({ query: q, numResults: 8, contents: { text: { maxCharacters: 1200 } } })
    });
    if (!r.ok) throw new Error(String(r.status));
    return ((await r.json()).results || []).map((x: any) => ({ title: x.title, url: x.url, text: x.text || '' }));
  }
  if (provider === 'tavily') {
    if (!k.tavily) throw new Error('add tavily key');
    const r = await netFetch(cfg, 'https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k.tavily },
      body: JSON.stringify({ query: q, max_results: 8, search_depth: 'advanced', api_key: k.tavily })
    });
    if (!r.ok) throw new Error(String(r.status));
    return ((await r.json()).results || []).map((x: any) => ({ title: x.title, url: x.url, text: x.content || '' }));
  }
  if (provider === 'ddg') {
    const r = await netFetch(cfg, 'https://r.jina.ai/https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q));
    if (!r.ok) throw new Error(String(r.status));
    const txt = await r.text();
    const out: SearchResult[] = [];
    const re = /\[([^\]]{3,120})\]\((https?:\/\/[^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) && out.length < 10) {
      if (/duckduckgo\.com/.test(m[2]) && !/uddg/.test(m[2])) continue;
      const u = decodeURIComponent((m[2].match(/uddg=([^&]+)/) || [])[1] || m[2]);
      if (out.some(o => o.url === u)) continue;
      out.push({ title: m[1], url: u, text: '' });
    }
    if (!out.length) throw new Error('blocked');
    return out;
  }
  if (provider === 'searx') {
    if (!k.searxUrl) throw new Error('add searx url');
    const r = await netFetch(cfg, k.searxUrl.replace(/\/$/, '') + '/search?format=json&q=' + encodeURIComponent(q));
    return ((await r.json()).results || []).slice(0, 8).map((x: any) => ({ title: x.title, url: x.url, text: x.content || '' }));
  }
  if (provider === 'brave') {
    if (!k.brave) throw new Error('add brave key');
    const r = await netFetch(cfg, 'https://api.search.brave.com/res/v1/web/search?count=8&q=' + encodeURIComponent(q), {
      headers: { 'X-Subscription-Token': k.brave, Accept: 'application/json' }
    });
    if (!r.ok) throw new Error(String(r.status));
    return ((await r.json()).web?.results || []).map((x: any) => ({ title: x.title, url: x.url, text: x.description || '' }));
  }
  if (provider === 'github') {
    const r = await netFetch(cfg, 'https://api.github.com/search/repositories?per_page=8&q=' + encodeURIComponent(q), {
      headers: { Accept: 'application/vnd.github+json', ...(k.github ? { Authorization: 'Bearer ' + k.github } : {}) }
    });
    if (!r.ok) throw new Error(String(r.status));
    return ((await r.json()).items || []).map((x: any) => ({
      title: x.full_name, url: x.html_url,
      text: (x.description || '') + ' stars:' + x.stargazers_count
    }));
  }
  if (provider === 'wiki') {
    const r = await netFetch(cfg, 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srlimit=6&srsearch=' + encodeURIComponent(q));
    return ((await r.json()).query?.search || []).map((x: any) => ({
      title: x.title,
      url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(x.title.replace(/ /g, '_')),
      text: x.snippet.replace(/<[^>]+>/g, '')
    }));
  }
  return [];
}

// ============ Search pipeline ============
export async function planQueries(cfg: Config, q: string): Promise<string[]> {
  const model = cfg.searchModel || cfg.model;
  if (!cfg.expand || !model) return [q];
  try {
    const txt = await llm(cfg, model, [
      { role: 'system', content: 'You are a search planner. Turn the question into ' + cfg.nQueries + ' short high-signal queries. Use operators (site:, filetype:, intitle:, inurl:, quotes) where useful. Focus: ' + cfg.mode + '. Return ONLY JSON: {"queries":["..."]}' },
      { role: 'user', content: q }
    ], { max: 500, temp: 0.5 });
    const j = parseJSON(txt);
    let qs: string[] = (j?.queries || []).filter((x: any) => typeof x === 'string' && x.trim()).slice(0, cfg.nQueries);
    if (!qs.length) throw new Error('none');
    if (!qs.includes(q)) qs.unshift(q);
    return qs;
  } catch {
    return [q];
  }
}

export async function fetchAllProviders(cfg: Config, qs: string[]): Promise<SearchResult[]> {
  const on = Object.keys(cfg.providers).filter(k => cfg.providers[k]);
  if (!on.length) throw new Error('no providers enabled');
  const ops = MODES[cfg.mode]?.ops || [];
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const q of qs) {
    const variants = ops.length ? [q, q + ' ' + ops[0], q + ' ' + ops[1]].filter(Boolean) : [q];
    for (const v of variants) {
      for (const p of on) {
        try {
          const got = await searchOne(cfg, p, v);
          for (const r of got) {
            if (!r.url || seen.has(r.url)) continue;
            seen.add(r.url);
            out.push(r);
          }
        } catch {}
      }
    }
  }
  return out;
}

export async function rankHits(cfg: Config, q: string, hits: SearchResult[]): Promise<SearchResult[]> {
  const model = cfg.searchModel || cfg.model;
  if (!cfg.rank || !model || hits.length < 3) return hits.slice(0, cfg.topK * 2);
  const list = hits.slice(0, 30).map((r, i) => '#' + (i + 1) + ' ' + (r.title || '') + '\n' + r.url + '\n' + (r.text || '').slice(0, 350)).join('\n\n');
  try {
    const txt = await llm(cfg, model, [
      { role: 'system', content: 'Rank results for relevance. Score 0-10, drop noise, one line on what each contains. ONLY JSON {"picks":[{"i":1,"score":9,"note":"..."}]} max ' + cfg.topK },
      { role: 'user', content: 'Question: ' + q + '\n\n' + list }
    ], { max: 1200, temp: 0.15 });
    const j = parseJSON(txt);
    const picks = (j?.picks || []).filter((p: any) => hits[p.i - 1]);
    if (!picks.length) throw new Error('none');
    return picks.slice(0, cfg.topK).map((p: any) => ({ ...hits[p.i - 1], note: p.note, score: p.score }));
  } catch {
    return hits.slice(0, cfg.topK);
  }
}

export async function synthesize(cfg: Config, q: string, hits: SearchResult[]): Promise<string> {
  const model = cfg.searchModel || cfg.model;
  if (!cfg.rank || !model || !hits.length) return '';
  try {
    const txt = await llm(cfg, model, [
      { role: 'system', content: 'Summarise what the sources establish in 3 short sentences. Note gaps. No preamble.' },
      { role: 'user', content: 'Q: ' + q + '\n\n' + hits.map((r, n) => '[' + (n + 1) + '] ' + (r.text || '').slice(0, 400)).join('\n') }
    ], { max: 400, temp: 0.2 });
    return txt.trim();
  } catch {
    return '';
  }
}

export async function pipeline(cfg: Config, q: string) {
  const qs = await planQueries(cfg, q);
  const raw = await fetchAllProviders(cfg, qs);
  const hits = await rankHits(cfg, q, raw);
  const summary = await synthesize(cfg, q, hits);
  return { hits, summary };
}

// ============ Tools ============
export interface ToolResult {
  name: string;
  sum: string;
  ok: boolean;
}

export const TOOLS: Record<string, { desc: string; run: (args: Record<string, any>, state: AppState, dispatch: (a: any) => void) => Promise<string> }> = {
  web_search: {
    desc: 'Search the web. args {query}',
    async run(a, state) {
      const q = String(a.query || '').trim();
      if (!q) throw new Error('query required');
      const hits = await fetchAllProviders(state.cfg, [q]);
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
      const r = await netFetch(state.cfg, 'https://api.github.com/search/repositories?per_page=8&q=' + encodeURIComponent(q), {
        headers: { Accept: 'application/vnd.github+json', ...(state.cfg.keys.github ? { Authorization: 'Bearer ' + state.cfg.keys.github } : {}) }
      });
      const j = await r.json();
      return (j.items || []).map((x: any) => x.full_name + ' stars:' + x.stargazers_count + ' - ' + (x.description || '')).join('\n') || 'none';
    }
  },
  save_memory: {
    desc: 'Persist a fact about the user. args {key,value}',
    async run(a, _state, dispatch) {
      if (!a.key) throw new Error('key required');
      dispatch({ type: 'ADD_MEM', entry: { id: uid(), k: String(a.key).slice(0, 80), v: String(a.value || '').slice(0, 600), src: 'agent', ts: Date.now() } });
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
        log: (...x: any[]) => logs.push(x.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ')),
        error: (...x: any[]) => logs.push('ERR ' + x.join(' ')),
        warn: (...x: any[]) => logs.push('WARN ' + x.join(' '))
      };
      try {
        const fn = new Function('console', 'return (async()=>{' + String(a.code || '') + '})()');
        const out = await fn(fake);
        if (out !== undefined) logs.push('=> ' + JSON.stringify(out));
      } catch (e: any) { logs.push('THROW ' + e.message); }
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

export async function runTool(name: string, args: Record<string, any>, state: AppState, dispatch: (a: any) => void): Promise<string> {
  const t = TOOLS[name];
  if (!t) return 'unknown tool ' + name;
  try { return await t.run(args, state, dispatch); }
  catch (e: any) { return 'TOOL ERROR ' + e.message; }
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

// ============ Share / Import ============
export const b64e = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/=+$/, '');
export const b64d = (s: string) => decodeURIComponent(escape(atob(s)));

// ============ Build messages for API ============
export function buildMsgs(state: AppState, chat: Chat, extra?: Message[]): unknown[] {
  const out: unknown[] = [];
  const sys: string[] = [state.cfg.system];
  if (state.mem.length) sys.push('Known facts about the user:\n' + state.mem.slice(0, 15).map(m => '- ' + m.k + ': ' + m.v).join('\n'));
  out.push({ role: 'system', content: sys.join('\n\n') });
  chat.messages.forEach(m => {
    if (m.images && m.images.length) {
      const parts: unknown[] = [{ type: 'text', text: m.content || '' }];
      m.images.forEach(u => parts.push({ type: 'image_url', image_url: { url: u } }));
      out.push({ role: m.role, content: parts });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  });
  if (extra) {
    extra.forEach(m => {
      if (m.images && m.images.length) {
        const parts: unknown[] = [{ type: 'text', text: m.content || '' }];
        m.images.forEach(u => parts.push({ type: 'image_url', image_url: { url: u } }));
        out.push({ role: m.role, content: parts });
      } else {
        out.push({ role: m.role, content: m.content });
      }
    });
  }
  return out;
}

export function buildAgentSystemMsg(state: AppState): string {
  const sys: string[] = [state.cfg.system];
  if (state.mem.length) sys.push('Known facts:\n' + state.mem.slice(0, 15).map(x => '- ' + x.k + ': ' + x.v).join('\n'));
  sys.push('You can call tools. Reply with ONLY JSON: {"tool":"name","args":{...}} or {"final":"short plan"}.');
  sys.push('Tools:\n' + TOOL_DOCS);
  return sys.filter(Boolean).join('\n\n');
}

// ============ Load models ============
export interface ModelInfo {
  id: string;
  ctx?: number;
  vision?: boolean;
  avail?: boolean;
}

export async function loadModels(cfg: Config): Promise<ModelInfo[]> {
  if (!cfg.key) return [];
  const q = cfg.onlyPlan ? '&available_on_current_plan=true' : '';
  const r = await netFetch(cfg, api(cfg, 'models?per_page=1000&sort=-popularity' + q), { headers: hdr(cfg) });
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json();
  return (j.data || []).filter((m: any) => !m.is_gated).map((m: any) => ({
    id: m.id,
    ctx: m.context_length,
    vision: m.vision_supported,
    avail: m.available_on_current_plan
  }));
}
