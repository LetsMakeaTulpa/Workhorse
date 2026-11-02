import { useReducer, useCallback, useEffect, useRef } from 'react';

const LSK = 'vf2.';
const db = {
  g<T>(k: string, d: T): T {
    try { const v = localStorage.getItem(LSK + k); return v ? JSON.parse(v) : d; }
    catch { return d; }
  },
  s(k: string, v: unknown) {
    try { localStorage.setItem(LSK + k, JSON.stringify(v)); } catch {}
  }
};

export const uid = () => Math.random().toString(36).slice(2, 10);
export const esc = (s: string) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  sources?: { title?: string; url: string; text?: string }[];
  tools?: { name: string; sum: string; ok: boolean }[];
}

export interface Chat {
  id: string;
  title: string;
  model: string;
  messages: Message[];
  ts: number;
  pin?: boolean;
}

export interface SearchResult {
  id?: string;
  title?: string;
  url: string;
  text?: string;
  note?: string;
  ts?: number;
}

export interface MemEntry {
  id: string;
  k: string;
  v: string;
  src: string;
  ts: number;
}

export interface PromptEntry {
  id: string;
  title: string;
  text: string;
  cat?: string;
}

export interface Config {
  baseUrl: string;
  key: string;
  proxy: string;
  temp: number;
  maxTokens: number;
  topP: number;
  system: string;
  searchOn: boolean;
  agent: boolean;
  mode: string;
  providers: Record<string, boolean>;
  keys: Record<string, string>;
  model: string;
  searchModel: string;
  tts: boolean;
  expand: boolean;
  rank: boolean;
  nQueries: number;
  topK: number;
  onlyPlan: boolean;
  favs: string[];
  recents: string[];
  tokens: number;
}

export interface ModelInfo {
  id: string;
  ctx?: number;
  vision?: boolean;
  avail?: boolean;
}

export interface AppState {
  cfg: Config;
  chats: Chat[];
  saved: SearchResult[];
  models: ModelInfo[];
  mem: MemEntry[];
  prompts: PromptEntry[];
  active: string | null;
  tab: 'chats' | 'results' | 'saved';
  results: SearchResult[];
  atts: string[];
  streaming: boolean;
  filter: string;
  summary: string;
  net: string;
  banner: { msg: string; ok: boolean } | null;
  modal: string | null;
  modalData?: any;
  rq: string;
}

const DEF: Config = {
  baseUrl: 'https://api.featherless.ai/v1',
  key: '',
  proxy: '',
  temp: 0.7,
  maxTokens: 2048,
  topP: 1,
  system: 'You are a precise, helpful assistant. Ground claims in supplied sources and cite with [n].',
  searchOn: false,
  agent: false,
  mode: 'general',
  providers: { exa: true, tavily: false, ddg: true, searx: false, brave: false, github: false, wiki: false },
  keys: { exa: '', tavily: '', brave: '', github: '', searxUrl: '' },
  model: '',
  searchModel: '',
  tts: false,
  expand: true,
  rank: true,
  nQueries: 4,
  topK: 6,
  onlyPlan: true,
  favs: [],
  recents: [],
  tokens: 0
};

function defaultPrompts(): PromptEntry[] {
  return [
    { id: uid(), title: 'Research & Cite', text: 'Research this topic thoroughly and cite all sources with [n] format: ' },
    { id: uid(), title: 'Summarize Page', text: 'Fetch and summarize this page: ' },
    { id: uid(), title: 'Code Review', text: 'Review this code for bugs, performance, and style: ' },
    { id: uid(), title: 'Explain Simply', text: 'Explain this in simple terms: ' },
  ];
}

export function getInitialState(): AppState {
  const cfg = { ...DEF, ...db.g('cfg', {}) };
  cfg.keys = { ...DEF.keys, ...cfg.keys };
  cfg.providers = { ...DEF.providers, ...cfg.providers };
  if (!Array.isArray(cfg.favs)) cfg.favs = [];
  if (!Array.isArray(cfg.recents)) cfg.recents = [];
  const prompts = db.g<PromptEntry[] | null>('prompts', null);
  return {
    cfg,
    chats: db.g('chats', []),
    saved: db.g('saved', []),
    models: (db.g('models', []) || []) as ModelInfo[],
    mem: db.g('mem', []),
    prompts: Array.isArray(prompts) ? prompts : defaultPrompts(),
    active: null,
    tab: 'chats',
    results: [],
    atts: [],
    streaming: false,
    filter: '',
    summary: '',
    net: 'unknown',
    banner: null,
    modal: null,
    rq: ''
  };
}

type Action =
  | { type: 'SET_CFG'; payload: Partial<Config> }
  | { type: 'SET_ACTIVE'; id: string | null }
  | { type: 'SET_TAB'; tab: 'chats' | 'results' | 'saved' }
  | { type: 'NEW_CHAT' }
  | { type: 'DEL_CHAT'; id: string }
  | { type: 'BRANCH_CHAT'; id: string }
  | { type: 'RENAME_CHAT'; id: string; title: string }
  | { type: 'PIN_CHAT'; id: string }
  | { type: 'ADD_MESSAGE'; chatId: string; msg: Message }
  | { type: 'UPDATE_LAST_MSG'; chatId: string; content: string }
  | { type: 'DEL_MESSAGE'; chatId: string; idx: number }
  | { type: 'EDIT_MESSAGE'; chatId: string; idx: number; content: string }
  | { type: 'SET_STREAMING'; v: boolean }
  | { type: 'SET_FILTER'; v: string }
  | { type: 'SET_RESULTS'; results: SearchResult[] }
  | { type: 'CLEAR_RESULTS' }
  | { type: 'SET_SUMMARY'; v: string }
  | { type: 'SET_NET'; v: string }
  | { type: 'SET_BANNER'; banner: { msg: string; ok: boolean } | null }
  | { type: 'SET_MODAL'; modal: string | null }
  | { type: 'ADD_SAVED'; item: SearchResult }
  | { type: 'DEL_SAVED'; id: string }
  | { type: 'ADD_MEM'; entry: MemEntry }
  | { type: 'DEL_MEM'; id: string }
  | { type: 'ADD_ATT'; src: string }
  | { type: 'DEL_ATT'; idx: number }
  | { type: 'CLEAR_ATTS' }
  | { type: 'SET_MODELS'; models: ModelInfo[] }
  | { type: 'SET_RQ'; v: string }
  | { type: 'ADD_PROMPT'; p: PromptEntry }
  | { type: 'DEL_PROMPT'; id: string }
  | { type: 'SET_MSG_SOURCES'; chatId: string; idx: number; sources: Message['sources'] }
  | { type: 'SET_MSG_TOOLS'; chatId: string; idx: number; tools: Message['tools'] };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_CFG':
      return { ...state, cfg: { ...state.cfg, ...action.payload } };
    case 'SET_ACTIVE':
      return { ...state, active: action.id };
    case 'SET_TAB':
      return { ...state, tab: action.tab };
    case 'NEW_CHAT': {
      const c: Chat = { id: uid(), title: 'new chat', model: state.cfg.model, messages: [], ts: Date.now() };
      return { ...state, chats: [c, ...state.chats], active: c.id };
    }
    case 'DEL_CHAT': {
      const chats = state.chats.filter(c => c.id !== action.id);
      return { ...state, chats, active: state.active === action.id ? (chats[0]?.id || null) : state.active };
    }
    case 'BRANCH_CHAT': {
      const orig = state.chats.find(c => c.id === action.id);
      if (!orig) return state;
      const n: Chat = { id: uid(), title: (orig.title || 'chat') + ' (branch)', model: orig.model, messages: JSON.parse(JSON.stringify(orig.messages)), ts: Date.now() };
      return { ...state, chats: [n, ...state.chats], active: n.id };
    }
    case 'RENAME_CHAT': {
      const chats = state.chats.map(c => c.id === action.id ? { ...c, title: action.title } : c);
      return { ...state, chats };
    }
    case 'PIN_CHAT': {
      const chats = state.chats.map(c => c.id === action.id ? { ...c, pin: !c.pin } : c);
      return { ...state, chats };
    }
    case 'ADD_MESSAGE': {
      const chats = state.chats.map(c => c.id === action.chatId ? { ...c, messages: [...c.messages, action.msg] } : c);
      return { ...state, chats };
    }
    case 'UPDATE_LAST_MSG': {
      const chats = state.chats.map(c => {
        if (c.id !== action.chatId) return c;
        const msgs = [...c.messages];
        if (msgs.length) msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: action.content };
        return { ...c, messages: msgs };
      });
      return { ...state, chats };
    }
    case 'DEL_MESSAGE': {
      const chats = state.chats.map(c => {
        if (c.id !== action.chatId) return c;
        const msgs = [...c.messages];
        msgs.splice(action.idx, 1);
        return { ...c, messages: msgs };
      });
      return { ...state, chats };
    }
    case 'EDIT_MESSAGE': {
      const chats = state.chats.map(c => {
        if (c.id !== action.chatId) return c;
        const msgs = [...c.messages];
        msgs[action.idx] = { ...msgs[action.idx], content: action.content };
        return { ...c, messages: msgs };
      });
      return { ...state, chats };
    }
    case 'SET_STREAMING':
      return { ...state, streaming: action.v };
    case 'SET_FILTER':
      return { ...state, filter: action.v };
    case 'SET_RESULTS':
      return { ...state, results: action.results };
    case 'CLEAR_RESULTS':
      return { ...state, results: [], summary: '' };
    case 'SET_SUMMARY':
      return { ...state, summary: action.v };
    case 'SET_NET':
      return { ...state, net: action.v };
    case 'SET_BANNER':
      return { ...state, banner: action.banner };
    case 'SET_MODAL':
      return { ...state, modal: action.modal };
    case 'ADD_SAVED':
      return { ...state, saved: [{ ...action.item, id: uid(), ts: Date.now() }, ...state.saved].slice(0, 300) };
    case 'DEL_SAVED':
      return { ...state, saved: state.saved.filter(s => s.id !== action.id) };
    case 'ADD_MEM':
      return { ...state, mem: [action.entry, ...state.mem].slice(0, 400) };
    case 'DEL_MEM':
      return { ...state, mem: state.mem.filter(m => m.id !== action.id) };
    case 'ADD_ATT':
      return { ...state, atts: [...state.atts, action.src] };
    case 'DEL_ATT': {
      const atts = [...state.atts];
      atts.splice(action.idx, 1);
      return { ...state, atts };
    }
    case 'CLEAR_ATTS':
      return { ...state, atts: [] };
    case 'SET_MODELS':
      return { ...state, models: action.models };
    case 'SET_RQ':
      return { ...state, rq: action.v };
    case 'ADD_PROMPT':
      return { ...state, prompts: [action.p, ...state.prompts] };
    case 'DEL_PROMPT':
      return { ...state, prompts: state.prompts.filter(p => p.id !== action.id) };
    case 'SET_MSG_SOURCES': {
      const chats = state.chats.map(c => {
        if (c.id !== action.chatId) return c;
        const msgs = [...c.messages];
        msgs[action.idx] = { ...msgs[action.idx], sources: action.sources };
        return { ...c, messages: msgs };
      });
      return { ...state, chats };
    }
    case 'SET_MSG_TOOLS': {
      const chats = state.chats.map(c => {
        if (c.id !== action.chatId) return c;
        const msgs = [...c.messages];
        msgs[action.idx] = { ...msgs[action.idx], tools: action.tools };
        return { ...c, messages: msgs };
      });
      return { ...state, chats };
    }
    default:
      return state;
  }
}

export function useStore() {
  const [state, dispatch] = useReducer(reducer, null, getInitialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Persist
  useEffect(() => { db.s('cfg', state.cfg); }, [state.cfg]);
  useEffect(() => { db.s('chats', state.chats.slice(0, 80)); }, [state.chats]);
  useEffect(() => { db.s('saved', state.saved.slice(0, 300)); }, [state.saved]);
  useEffect(() => { db.s('mem', state.mem.slice(0, 400)); }, [state.mem]);
  useEffect(() => { db.s('prompts', state.prompts); }, [state.prompts]);
  useEffect(() => { db.s('models', state.models); }, [state.models]);

  const cur = useCallback(() => stateRef.current.chats.find(c => c.id === stateRef.current.active), []);

  return { state, dispatch, stateRef, cur };
}

export type StoreReturn = ReturnType<typeof useStore>;
