import React, { useEffect, useRef, useState, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { useStore, esc, uid, type AppState, type Message, type ModelInfo } from './store';
import {
  llm, parseJSON, pipeline, runTool, TOOL_DOCS, MODES, DORKS, countTok,
  api, hdr, netFetch, isNet, stream, buildMsgs, buildAgentSystemMsg,
  loadModels as fetchModels, b64e, b64d, searchOne, type ToolResult
} from './tools';
import 'katex/dist/katex.min.css';

marked.setOptions({ breaks: true, gfm: true });

function md(t: string) {
  let h: string;
  try { h = marked.parse(t || '') as string; }
  catch { h = esc(t || '').replace(/\n/g, '<br>'); }
  return DOMPurify.sanitize(h, { ADD_ATTR: ['target'] });
}

function mathify(node: HTMLElement) {
  try {
    let html = node.innerHTML;
    html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => {
      try { return katex.renderToString(tex, { displayMode: true, throwOnError: false }); }
      catch { return _; }
    });
    html = html.replace(/\\\(([\s\S]*?)\\\)/g, (_, tex) => {
      try { return katex.renderToString(tex, { displayMode: false, throwOnError: false }); }
      catch { return _; }
    });
    node.innerHTML = html;
  } catch {}
}

function toastEl(msg: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

// Icons
const Icons = {
  plus: <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>,
  chat: <svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/></svg>,
  search: <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>,
  bookmark: <svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>,
  brain: <svg viewBox="0 0 24 24"><path d="M12 3a4 4 0 0 1 4 4v1a4 4 0 0 1 0 8v1a4 4 0 0 1-8 0v-1a4 4 0 0 1 0-8V7a4 4 0 0 1 4-4z"/></svg>,
  list: <svg viewBox="0 0 24 24"><path d="M4 5h16M4 10h10M4 15h16M4 20h7"/></svg>,
  help: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.6.2-.9.8-.9 1.4v.3M12 17h.01"/></svg>,
  settings: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 13.7H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7L4.5 7a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>,
  globe: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>,
  robot: <svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="11" rx="2"/><path d="M12 8V5M9 13h.01M15 13h.01M9 16h6"/></svg>,
  code: <svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4"/></svg>,
  share: <svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v13M8 7l4-4 4 4"/></svg>,
  download: <svg viewBox="0 0 24 24"><path d="M12 3v13M8 12l4 4 4-4M4 21h16"/></svg>,
  paperclip: <svg viewBox="0 0 24 24"><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15.5 8"/></svg>,
  volume: <svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5zM16 9a4 4 0 0 1 0 6"/></svg>,
};

export default function App() {
  const { state, dispatch, stateRef } = useStore();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; chatId: string } | null>(null);

  // Auto-scroll
  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [state.chats, state.streaming]);

  // Context menu close
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => setCtxMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [ctxMenu]);

  // Import from hash
  useEffect(() => {
    const h = location.hash;
    if (!h.startsWith('#s=')) return;
    try {
      const p = JSON.parse(b64d(h.slice(3)));
      if (p.kind === 'result') {
        dispatch({ type: 'ADD_SAVED', item: p });
        dispatch({ type: 'SET_TAB', tab: 'saved' });
      } else {
        const c = { id: uid(), title: (p.title || 'shared') + ' (shared)', model: p.model || stateRef.current.cfg.model, messages: p.messages || [], ts: Date.now() };
        dispatch({ type: 'NEW_CHAT' });
        p.messages?.forEach((m: Message) => dispatch({ type: 'ADD_MESSAGE', chatId: c.id, msg: m }));
      }
    } catch {}
  }, []);

  // Probe network on mount
  useEffect(() => {
    probe();
    if (!stateRef.current.cfg.key) {
      setTimeout(() => dispatch({ type: 'SET_MODAL', modal: 'setup' }), 350);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA/.test((e.target as HTMLElement)?.tagName || '');
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); dispatch({ type: 'SET_CFG', payload: { searchOn: !stateRef.current.cfg.searchOn } }); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'j') { e.preventDefault(); dispatch({ type: 'SET_CFG', payload: { agent: !stateRef.current.cfg.agent } }); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); dispatch({ type: 'NEW_CHAT' }); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'p') { e.preventDefault(); dispatch({ type: 'SET_MODAL', modal: 'prompts' }); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'm') { e.preventDefault(); dispatch({ type: 'SET_MODAL', modal: 'memory' }); }
      else if (e.key === '?' && !typing) { e.preventDefault(); dispatch({ type: 'SET_MODAL', modal: 'help' }); }
      else if (e.key === 'Escape') { dispatch({ type: 'SET_MODAL', modal: null }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dispatch, stateRef]);

  // Drag/drop
  useEffect(() => {
    const onDragOver = (e: Event) => e.preventDefault();
    const onDrop = (e: Event) => { e.preventDefault(); addFiles((e as DragEvent).dataTransfer?.files); };
    const app = document.querySelector('.app');
    if (app) { app.addEventListener('dragover', onDragOver); app.addEventListener('drop', onDrop); }
    return () => { if (app) { app.removeEventListener('dragover', onDragOver); app.removeEventListener('drop', onDrop); } };
  }, []);

  async function probe() {
    const cfg = stateRef.current.cfg;
    dispatch({ type: 'SET_NET', v: 'checking' });
    if (!cfg.key) { dispatch({ type: 'SET_NET', v: 'no-key' }); return; }
    let direct = '', proxy = '';
    try {
      const r = await fetch(api(cfg, 'models?per_page=1'), { headers: hdr(cfg) });
      if (r.ok) {
        dispatch({ type: 'SET_NET', v: 'direct' });
        dispatch({ type: 'SET_BANNER', banner: { msg: 'connected directly', ok: true } });
        setTimeout(() => dispatch({ type: 'SET_BANNER', banner: null }), 4000);
        loadModelsList();
        return;
      }
      direct = 'http ' + r.status;
    } catch { direct = 'blocked'; }
    if (cfg.proxy) {
      try {
        const r = await fetch(cfg.proxy.replace(/\/$/, '') + '/' + api(cfg, 'models?per_page=1'), { headers: hdr(cfg) });
        if (r.ok) {
          dispatch({ type: 'SET_NET', v: 'proxy' });
          dispatch({ type: 'SET_BANNER', banner: { msg: 'connected through proxy', ok: true } });
          setTimeout(() => dispatch({ type: 'SET_BANNER', banner: null }), 4000);
          loadModelsList();
          return;
        }
        proxy = 'http ' + r.status;
      } catch { proxy = 'unreachable'; }
    }
    dispatch({ type: 'SET_NET', v: 'down' });
    dispatch({ type: 'SET_BANNER', banner: { msg: 'no internet path - direct: ' + direct + (cfg.proxy ? ' / proxy: ' + proxy : '') + ' - run the proxy from setup', ok: false } });
  }

  async function loadModelsList() {
    try {
      const models = await fetchModels(stateRef.current.cfg);
      dispatch({ type: 'SET_MODELS', models });
      const cfg = stateRef.current.cfg;
      if (!cfg.model && models.length) dispatch({ type: 'SET_CFG', payload: { model: models[0].id } });
      if (!cfg.searchModel && models.length) dispatch({ type: 'SET_CFG', payload: { searchModel: models[0].id } });
    } catch (e: any) {
      toastEl('load models failed: ' + e.message);
    }
  }

  // ============ Send ============
  async function send() {
    if (stateRef.current.streaming) return stop();
    const cfg = stateRef.current.cfg;
    const chat = stateRef.current.chats.find(c => c.id === stateRef.current.active);
    const input = inputRef.current;
    if (!input) return;
    const text = input.value.trim();
    if (!text && !stateRef.current.atts.length) return;
    if (!cfg.key) { dispatch({ type: 'SET_MODAL', modal: 'setup' }); return; }
    if (!cfg.model && !chat?.model) { dispatch({ type: 'SET_MODAL', modal: 'models' }); return; }
    if (!stateRef.current.active) dispatch({ type: 'NEW_CHAT' });

    const c = stateRef.current.chats.find(x => x.id === stateRef.current.active)!;
    if (c.messages.length === 0) {
      const title = text.slice(0, 42) || 'image';
      dispatch({ type: 'RENAME_CHAT', id: c.id, title });
    }

    const imgs = [...stateRef.current.atts];
    input.value = '';
    dispatch({ type: 'CLEAR_ATTS' });

    const userMsg: Message = { role: 'user', content: text, images: imgs.length ? imgs : undefined };
    dispatch({ type: 'ADD_MESSAGE', chatId: c.id, msg: userMsg });

    const assistantMsg: Message = { role: 'assistant', content: '', sources: [], tools: [] };
    dispatch({ type: 'ADD_MESSAGE', chatId: c.id, msg: assistantMsg });

    dispatch({ type: 'SET_STREAMING', v: true });
    ctrlRef.current = new AbortController();

    try {
      if (cfg.agent) {
        await agentLoop(c, assistantMsg, text);
      } else {
        await plainRun(c, assistantMsg, text);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        dispatch({ type: 'EDIT_MESSAGE', chatId: c.id, idx: c.messages.length - 1, content: (assistantMsg.content || '') + '\n\n_stopped_' });
      } else if (isNet(e)) {
        dispatch({ type: 'EDIT_MESSAGE', chatId: c.id, idx: c.messages.length - 1, content: '**no connection** ' + esc(e.message) + '\n\nOpen setup and run the proxy.' });
        dispatch({ type: 'SET_BANNER', banner: { msg: e.message + ' - open setup and start the proxy', ok: false } });
      } else {
        dispatch({ type: 'EDIT_MESSAGE', chatId: c.id, idx: c.messages.length - 1, content: '**error** ' + esc(e.message) });
      }
    } finally {
      dispatch({ type: 'SET_STREAMING', v: false });
      ctrlRef.current = null;
      if (cfg.tts && assistantMsg.content) speak(assistantMsg.content);
    }
  }

  async function plainRun(c: any, m: Message, text: string) {
    const cfg = stateRef.current.cfg;
    let content = text;
    if (cfg.searchOn) {
      try {
        const res = await pipeline(cfg, text);
        const sources = res.hits;
        if (sources.length) {
          content = 'Web results for "' + text + '":\n\n' +
            (res.summary ? 'Model notes: ' + res.summary + '\n\n' : '') +
            sources.map((r: any, n: number) => '[' + (n + 1) + '] ' + (r.title || '') + '\n' + r.url + '\n' + (r.text || '').slice(0, 900)).join('\n\n') +
            '\n\nQuestion: ' + text + '\n\nAnswer using the results and cite [n].';
          // Update user message content
          const userIdx = c.messages.length - 2;
          dispatch({ type: 'EDIT_MESSAGE', chatId: c.id, idx: userIdx, content });
        }
      } catch (e: any) {
        toastEl('search failed: ' + e.message);
        if (isNet(e)) dispatch({ type: 'SET_BANNER', banner: { msg: e.message, ok: false } });
      }
    }

    const msgs = buildMsgs(stateRef.current, c);
    let accumulated = '';
    const toks = await stream(cfg, c, msgs, (chunk) => {
      accumulated += chunk;
      dispatch({ type: 'EDIT_MESSAGE', chatId: c.id, idx: c.messages.length - 1, content: accumulated });
    }, ctrlRef.current?.signal);

    dispatch({ type: 'SET_CFG', payload: { tokens: cfg.tokens + (toks || 0) } });
  }

  async function agentLoop(c: any, m: Message, text: string) {
    const cfg = stateRef.current.cfg;
    const model = c.model || cfg.model;
    const sysContent = buildAgentSystemMsg(stateRef.current);
    const msgs: any[] = [{ role: 'system', content: sysContent }, { role: 'user', content: text }];
    const collected: string[] = [];
    const toolCalls: ToolResult[] = [];

    for (let step = 0; step < 6; step++) {
      let raw = '';
      try { raw = await llm(cfg, model, msgs, { max: 700, temp: 0.25 }); } catch { break; }
      const act = parseJSON(raw);
      if (!act || !act.tool) {
        if (act && act.final) break;
        break;
      }
      const args = act.args || {};
      const shown = args.query || args.url || args.key || args.prompt || (args.code ? String(args.code).slice(0, 60) : '');
      const out = await runTool(act.tool, args, stateRef.current, dispatch);
      const ok = !out.startsWith('TOOL ERROR');
      toolCalls.push({ name: act.tool, sum: String(shown).slice(0, 90) || '(no args)', ok });
      dispatch({ type: 'SET_MSG_TOOLS', chatId: c.id, idx: c.messages.length - 1, tools: [...toolCalls] });
      collected.push('### ' + act.tool + '(' + JSON.stringify(args).slice(0, 160) + ')\n' + out.slice(0, 2500));
      if (act.tool === 'generate_image' && ok && /^https?:/.test(out)) {
        m.images = (m.images || []).concat(out);
      }
      msgs.push({ role: 'assistant', content: JSON.stringify(act).slice(0, 400) });
      msgs.push({ role: 'user', content: 'TOOL RESULT\n' + out.slice(0, 3000) });
    }

    const prompt = 'Question: ' + text + '\n\nTool results:\n\n' + collected.join('\n\n') +
      '\n\nWrite the final answer. Cite sources as [n] where they came from searches.';
    const cc = { model, messages: [{ role: 'system', content: sysContent }, { role: 'user', content: prompt }] };
    let accumulated = '';
    const toks = await stream(cfg, cc as any, cc.messages, (chunk) => {
      accumulated += chunk;
      dispatch({ type: 'EDIT_MESSAGE', chatId: c.id, idx: c.messages.length - 1, content: accumulated });
    }, ctrlRef.current?.signal);
    dispatch({ type: 'SET_CFG', payload: { tokens: cfg.tokens + (toks || 0) } });
  }

  function stop() { ctrlRef.current?.abort(); }

  async function regen(idx: number) {
    const c = stateRef.current.chats.find(x => x.id === stateRef.current.active);
    if (!c || stateRef.current.streaming) return;
    const prev = c.messages[idx - 1];
    // Remove from idx onwards
    const newMsgs = c.messages.slice(0, idx);
    // Replace messages
    dispatch({ type: 'DEL_MESSAGE', chatId: c.id, idx });
    const assistantMsg: Message = { role: 'assistant', content: '', sources: [], tools: [] };
    dispatch({ type: 'ADD_MESSAGE', chatId: c.id, msg: assistantMsg });
    dispatch({ type: 'SET_STREAMING', v: true });
    ctrlRef.current = new AbortController();

    try {
      if (stateRef.current.cfg.agent) {
        await agentLoop(c, assistantMsg, prev?.content || '');
      } else {
        const msgs = buildMsgs(stateRef.current, { ...c, messages: newMsgs });
        let accumulated = '';
        const toks = await stream(stateRef.current.cfg, c, msgs, (chunk) => {
          accumulated += chunk;
          dispatch({ type: 'EDIT_MESSAGE', chatId: c.id, idx: c.messages.length - 1, content: accumulated });
        }, ctrlRef.current?.signal);
        dispatch({ type: 'SET_CFG', payload: { tokens: stateRef.current.cfg.tokens + (toks || 0) } });
      }
    } catch (e: any) {
      dispatch({ type: 'EDIT_MESSAGE', chatId: c.id, idx: c.messages.length - 1, content: '**error** ' + esc(e.message) });
    } finally {
      dispatch({ type: 'SET_STREAMING', v: false });
      ctrlRef.current = null;
    }
  }

  function speak(txt: string) {
    if (!window.speechSynthesis) return toastEl('no tts');
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(txt.replace(/[#*`_>\[\]()]/g, '').slice(0, 4000)));
  }

  // Search
  async function doSearch(q: string) {
    if (!q) return;
    if (!stateRef.current.cfg.key) { dispatch({ type: 'SET_MODAL', modal: 'setup' }); return; }
    dispatch({ type: 'SET_TAB', tab: 'results' });
    dispatch({ type: 'SET_RESULTS', results: [] });
    dispatch({ type: 'SET_SUMMARY', v: '' });
    try {
      const r = await pipeline(stateRef.current.cfg, q);
      dispatch({ type: 'SET_RESULTS', results: r.hits });
      dispatch({ type: 'SET_SUMMARY', v: r.summary });
      if (!r.hits.length) toastEl('no results');
    } catch (e: any) {
      toastEl(e.message);
      if (isNet(e)) dispatch({ type: 'SET_BANNER', banner: { msg: e.message, ok: false } });
    }
  }

  // Read page
  async function readPage(url: string) {
    try {
      toastEl('reading...');
      const r = await netFetch(stateRef.current.cfg, 'https://r.jina.ai/' + url);
      const txt = await r.text();
      dispatch({ type: 'SET_MODAL', modal: 'reader' });
      dispatch({ type: 'SET_MODAL', modal: null }); // We'll use a different approach
      // Show in a simple way
      const w = window.open('', '_blank');
      if (w) {
        w.document.write('<pre style="white-space:pre-wrap;font-size:12px;padding:20px">' + esc(txt.slice(0, 8000)) + '</pre>');
      }
    } catch { toastEl('read failed'); }
  }

  // Export
  function exportChat() {
    const c = stateRef.current.chats.find(x => x.id === stateRef.current.active);
    if (!c) return toastEl('no chat');
    const b = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = (c.title || 'chat').replace(/\W+/g, '-') + '.json';
    a.click();
  }

  // Share
  function shareChat() {
    const c = stateRef.current.chats.find(x => x.id === stateRef.current.active);
    if (!c) return toastEl('no chat');
    sharePayload({ kind: 'chat', title: c.title, model: c.model, ts: Date.now(), messages: c.messages.map(m => ({ role: m.role, content: m.content, sources: m.sources })) });
  }

  function sharePayload(p: any) {
    const data = b64e(JSON.stringify(p));
    const url = location.origin + location.pathname + '#s=' + data;
    if (url.length < 7000) history.replaceState(null, '', '#s=' + data);
    navigator.clipboard.writeText(url);
    toastEl('share link copied');
  }

  // Files
  function addFiles(fs: FileList | null | undefined) {
    if (!fs) return;
    [...fs].forEach(f => {
      if (!f.type.startsWith('image/')) return;
      const r = new FileReader();
      r.onload = () => { dispatch({ type: 'ADD_ATT', src: r.result as string }); };
      r.readAsDataURL(f);
    });
  }

  const activeChat = state.chats.find(c => c.id === state.active);

  return (
    <div className="app">
      {/* Rail */}
      <aside className="rail">
        <div className="brand">V</div>
        <button onClick={() => dispatch({ type: 'NEW_CHAT' })} title="New chat (Ctrl+N)">{Icons.plus}</button>
        <button className={state.tab === 'chats' ? 'on' : ''} onClick={() => dispatch({ type: 'SET_TAB', tab: 'chats' })} title="Chats">{Icons.chat}</button>
        <button className={state.tab === 'results' ? 'on' : ''} onClick={() => dispatch({ type: 'SET_TAB', tab: 'results' })} title="Search">{Icons.search}</button>
        <button className={state.tab === 'saved' ? 'on' : ''} onClick={() => dispatch({ type: 'SET_TAB', tab: 'saved' })} title="Saved">{Icons.bookmark}</button>
        <button onClick={() => dispatch({ type: 'SET_MODAL', modal: 'memory' })} title="Memory (Ctrl+M)">{Icons.brain}</button>
        <button onClick={() => dispatch({ type: 'SET_MODAL', modal: 'prompts' })} title="Prompt library (Ctrl+P)">{Icons.list}</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => dispatch({ type: 'SET_MODAL', modal: 'help' })} title="Shortcuts (?)">{Icons.help}</button>
        <button onClick={() => dispatch({ type: 'SET_MODAL', modal: 'setup' })} title="Setup">{Icons.settings}</button>
      </aside>

      {/* Sidebar */}
      <aside className="side">
        <div className="side-head">
          <input placeholder="Filter" value={state.filter} onChange={e => dispatch({ type: 'SET_FILTER', v: e.target.value })} />
          <button onClick={() => dispatch({ type: 'NEW_CHAT' })} title="New chat">+</button>
        </div>
        <div className="side-body">
          {state.tab === 'chats' && <ChatsTab state={state} dispatch={dispatch} setCtxMenu={setCtxMenu} />}
          {state.tab === 'results' && <ResultsTab state={state} dispatch={dispatch} doSearch={doSearch} readPage={readPage} />}
          {state.tab === 'saved' && <SavedTab state={state} dispatch={dispatch} />}
        </div>
        <div className="side-foot">
          <span>{state.cfg.tokens.toLocaleString()} tokens</span>
          <span>{state.net === 'direct' ? '●' : state.net === 'down' ? '✗' : '○'} {state.net}</span>
        </div>
      </aside>

      {/* Main */}
      <main className="main">
        <div className="top">
          <button className="model-btn" onClick={() => dispatch({ type: 'SET_MODAL', modal: 'models' })}>
            {activeChat?.model || state.cfg.model || 'choose model'}
          </button>
          <button className={'tbtn' + (state.cfg.searchOn ? ' on' : '')} onClick={() => dispatch({ type: 'SET_CFG', payload: { searchOn: !state.cfg.searchOn } })} title="Web search (Ctrl+K)">{Icons.globe}</button>
          <button className={'tbtn' + (state.cfg.agent ? ' on' : '')} onClick={() => { dispatch({ type: 'SET_CFG', payload: { agent: !state.cfg.agent } }); toastEl(state.cfg.agent ? 'agent mode off' : 'agent mode on'); }} title="Agent mode (Ctrl+J)">{Icons.robot}</button>
          <button className="tbtn" onClick={() => dispatch({ type: 'SET_MODAL', modal: 'dorks' })} title="Dork builder">{Icons.code}</button>
          <button className="tbtn" onClick={shareChat} title="Share">{Icons.share}</button>
          <button className="tbtn" onClick={exportChat} title="Export">{Icons.download}</button>
        </div>

        {state.banner && (
          <div className={'banner' + (state.banner.ok ? ' ok' : '')}>
            <span className="dot" />
            <span className="g">{state.banner.msg}</span>
            <button onClick={() => dispatch({ type: 'SET_MODAL', modal: 'setup' })}>fix</button>
            <button onClick={probe}>retest</button>
            <button onClick={() => dispatch({ type: 'SET_BANNER', banner: null })}>x</button>
          </div>
        )}

        <div className="msgs" ref={msgsRef}>
          {!activeChat ? (
            <div className="empty">
              <h2>Agentic client, your own endpoint</h2>
              <p>Agent mode gives the model tools: search, page reads, GitHub, memory, code execution and image generation. Everything runs on your Featherless key.</p>
              <div className="chips">
                {['Research this and cite sources: ', 'Remember that ', 'Write and run JS to ', 'Generate an image of '].map(p => (
                  <button key={p} className="chip" onClick={() => { if (inputRef.current) { inputRef.current.value = p; inputRef.current.focus(); } }}>{p.split(' ').slice(0, 2).join(' ')}</button>
                ))}
              </div>
            </div>
          ) : activeChat.messages.length === 0 ? (
            <div className="empty">
              <h2>{esc(activeChat.title)}</h2>
              <p>Pick a model above, toggle agent mode for tools, then send.</p>
            </div>
          ) : (
            activeChat.messages.map((msg, i) => (
              <MessageView key={i} msg={msg} chatId={activeChat.id} idx={i} dispatch={dispatch} speak={speak} regen={regen} />
            ))
          )}
          {state.streaming && activeChat && activeChat.messages.length > 0 && activeChat.messages[activeChat.messages.length - 1].role === 'user' && (
            <div className="msg"><div className="who"><b>assistant</b></div><div className="body"><em style={{ color: 'var(--mut)' }}>thinking...</em></div></div>
          )}
        </div>

        <div className="composer">
          {state.atts.length > 0 && (
            <div className="attachments">
              {state.atts.map((src, i) => (
                <div key={i} className="att">
                  <img src={src} alt="" />
                  <button onClick={() => dispatch({ type: 'DEL_ATT', idx: i })}>×</button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            placeholder="Message... (enter to send, shift+enter newline)"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <div className="cbar">
            <button className="tbtn" onClick={() => fileRef.current?.click()} title="Attach image">{Icons.paperclip}</button>
            <button className="tbtn" onClick={() => {
              const chat = stateRef.current.chats.find(c => c.id === stateRef.current.active);
              if (chat) { const last = chat.messages.filter(m => m.role === 'assistant').pop(); if (last) speak(last.content); }
            }} title="Read aloud">{Icons.volume}</button>
            <span className="hint">
              {state.cfg.agent ? 'agent on — tools: search, read, github, memory, code, image' :
               state.cfg.searchOn ? 'search via ' + (state.cfg.searchModel || 'no model') + ' — mode: ' + state.cfg.mode : ''}
            </span>
            <button className={'send' + (state.streaming ? ' stop' : '')} onClick={send}>
              {state.streaming ? 'Stop' : 'Send'}
            </button>
          </div>
          <input type="file" ref={fileRef} accept="image/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>
      </main>

      {/* Context menu */}
      {ctxMenu && (
        <div className="ctx" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={e => e.stopPropagation()}>
          <CtxMenuItems chatId={ctxMenu.chatId} dispatch={dispatch} onClose={() => setCtxMenu(null)} state={state} />
        </div>
      )}

      {/* Modal */}
      {state.modal && (
        <div className="modal" onClick={() => dispatch({ type: 'SET_MODAL', modal: null })}>
          <div className="box" onClick={e => e.stopPropagation()}>
            {state.modal === 'setup' && <SetupModal state={state} dispatch={dispatch} probe={probe} />}
            {state.modal === 'models' && <ModelsModal state={state} dispatch={dispatch} loadModels={loadModelsList} />}
            {state.modal === 'help' && <HelpModal />}
            {state.modal === 'memory' && <MemoryModal state={state} dispatch={dispatch} />}
            {state.modal === 'prompts' && <PromptsModal state={state} dispatch={dispatch} />}
            {state.modal === 'dorks' && <DorksModal doSearch={doSearch} dispatch={dispatch} />}
            {state.modal === 'docs' && <DocsModal />}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Sub-components ============

function ChatsTab({ state, dispatch, setCtxMenu }: { state: AppState; dispatch: React.Dispatch<any>; setCtxMenu: (v: any) => void }) {
  const list = state.chats.filter(c => !state.filter || c.title.toLowerCase().includes(state.filter.toLowerCase()));
  const sorted = list.slice().sort((a, z) => (z.pin ? 1 : 0) - (a.pin ? 1 : 0) || z.ts - a.ts);
  return (
    <>
      {sorted.length === 0 && <div className="grouplbl">no chats yet</div>}
      {sorted.map(c => (
        <div key={c.id} className={'item' + (c.id === state.active ? ' on' : '')}
          onClick={() => dispatch({ type: 'SET_ACTIVE', id: c.id })}
          onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: Math.min(e.clientX, innerWidth - 160), y: Math.min(e.clientY, innerHeight - 120), chatId: c.id }); }}>
          <span className="t">{esc(c.title)}</span>
          {c.pin && <span className="pin">●</span>}
        </div>
      ))}
      <div className="grouplbl">right-click a chat for pin, branch, delete</div>
    </>
  );
}

function CtxMenuItems({ chatId, dispatch, onClose, state }: { chatId: string; dispatch: React.Dispatch<any>; onClose: () => void; state: AppState }) {
  const chat = state.chats.find(c => c.id === chatId);
  return (
    <>
      <button onClick={() => { dispatch({ type: 'PIN_CHAT', id: chatId }); onClose(); }}>{chat?.pin ? 'unpin' : 'pin'}</button>
      <button onClick={() => { dispatch({ type: 'BRANCH_CHAT', id: chatId }); onClose(); toastEl('branched'); }}>branch</button>
      <button onClick={() => { const t = prompt('title', chat?.title); if (t) { dispatch({ type: 'RENAME_CHAT', id: chatId, title: t }); } onClose(); }}>rename</button>
      <button onClick={() => { dispatch({ type: 'DEL_CHAT', id: chatId }); onClose(); }}>delete</button>
    </>
  );
}

function ResultsTab({ state, dispatch, doSearch, readPage }: { state: AppState; dispatch: React.Dispatch<any>; doSearch: (q: string) => void; readPage: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="modes">
        {Object.entries(MODES).map(([k, v]) => (
          <button key={k} className={state.cfg.mode === k ? 'on' : ''} onClick={() => dispatch({ type: 'SET_CFG', payload: { mode: k } })}>{v.label}</button>
        ))}
      </div>
      <ProviderPicker state={state} dispatch={dispatch} />
      <button className="sm-btn" onClick={() => dispatch({ type: 'SET_MODAL', modal: 'models' })}>
        search model: {state.cfg.searchModel || 'pick one'}
      </button>
      <label className="mini">
        <input type="checkbox" checked={!!state.cfg.expand} onChange={e => dispatch({ type: 'SET_CFG', payload: { expand: e.target.checked } })} />
        let model write queries
      </label>
      <label className="mini">
        <input type="checkbox" checked={!!state.cfg.rank} onChange={e => dispatch({ type: 'SET_CFG', payload: { rank: e.target.checked } })} />
        let model score results
      </label>
      <div className="row">
        <input ref={inputRef} placeholder="query or dork" defaultValue={state.rq} onKeyDown={e => { if (e.key === 'Enter') doSearch((e.target as HTMLInputElement).value); }} />
        <button className="btn" style={{ flex: '0 0 auto' }} onClick={() => doSearch(inputRef.current?.value || '')}>go</button>
      </div>
      <DorkButtons apply={(v) => { dispatch({ type: 'SET_RQ', v }); if (inputRef.current) inputRef.current.value = v; doSearch(v); }} />
      {state.summary && (
        <div className="sum">
          <b>model analysis</b>{esc(state.summary)}
          <button className="btn sm" style={{ marginTop: 5 }} onClick={() => dispatch({ type: 'CLEAR_RESULTS' })}>clear</button>
        </div>
      )}
      {state.results.length === 0 && <div className="grouplbl">results land here</div>}
      {state.results.map((r, i) => (
        <div key={i} className="res">
          <a className="rt" href={r.url} target="_blank" rel="noopener">{esc(r.title || r.url)}</a>
          <div className="ru">{esc(r.url)}</div>
          <div className="rs">{esc((r.text || '').slice(0, 320))}</div>
          {r.note && <div className="note">{esc(r.note)}</div>}
          <div className="ra">
            <button onClick={() => window.open(r.url, '_blank', 'noopener')}>open</button>
            <button onClick={() => readPage(r.url)}>read</button>
            <button onClick={() => { dispatch({ type: 'ADD_SAVED', item: r }); toastEl('saved'); }}>save</button>
            <button onClick={() => { const t = document.querySelector('.composer textarea') as HTMLTextAreaElement; if (t) { t.value += (t.value ? '\n' : '') + r.url + ' '; t.focus(); } }}>use</button>
          </div>
        </div>
      ))}
      {state.results.length > 0 && <button className="btn" onClick={() => dispatch({ type: 'CLEAR_RESULTS' })}>clear results</button>}
    </>
  );
}

function SavedTab({ state, dispatch }: { state: AppState; dispatch: React.Dispatch<any> }) {
  return (
    <>
      {state.saved.length === 0 && <div className="grouplbl">nothing saved</div>}
      {state.saved.map(r => (
        <div key={r.id} className="res">
          <a className="rt" href={r.url} target="_blank" rel="noopener">{esc(r.title || r.url)}</a>
          <div className="ru">{esc(r.url)}</div>
          <div className="rs">{esc((r.text || '').slice(0, 200))}</div>
          <div className="ra">
            <button onClick={() => window.open(r.url, '_blank', 'noopener')}>open</button>
            <button onClick={() => { navigator.clipboard.writeText(r.title + '\n' + r.url + '\n' + (r.text || '')); toastEl('copied'); }}>copy</button>
            <button onClick={() => {
              const data = b64e(JSON.stringify({ kind: 'result', ...r }));
              const url = location.origin + location.pathname + '#s=' + data;
              navigator.clipboard.writeText(url);
              toastEl('share link copied');
            }}>share</button>
            <button onClick={() => dispatch({ type: 'DEL_SAVED', id: r.id! })}>del</button>
          </div>
        </div>
      ))}
    </>
  );
}

function ProviderPicker({ state, dispatch }: { state: AppState; dispatch: React.Dispatch<any> }) {
  const providers: [string, string][] = [['exa', 'exa'], ['tavily', 'tavily'], ['ddg', 'duckduckgo'], ['searx', 'searxng'], ['brave', 'brave'], ['github', 'github'], ['wiki', 'wikipedia']];
  return (
    <div className="prov">
      {providers.map(([k, label]) => (
        <label key={k} className={state.cfg.providers[k] ? 'on' : ''}>
          <input type="checkbox" checked={!!state.cfg.providers[k]} onChange={e => dispatch({ type: 'SET_CFG', payload: { providers: { ...state.cfg.providers, [k]: e.target.checked } } })} />
          {label}
        </label>
      ))}
    </div>
  );
}

function DorkButtons({ apply }: { apply: (v: string) => void }) {
  return (
    <div className="dorks">
      {DORKS.map(([d, l]) => (
        <button key={l} title={d} onClick={() => apply(d)}>{l}</button>
      ))}
    </div>
  );
}

function MessageView({ msg, chatId, idx, dispatch, speak, regen }: { msg: Message; chatId: string; idx: number; dispatch: React.Dispatch<any>; speak: (t: string) => void; regen: (i: number) => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current && msg.role === 'assistant') mathify(bodyRef.current);
  }, [msg.content, msg.role]);

  return (
    <div className={'msg ' + (msg.role === 'user' ? 'u' : 'a')}>
      <div className="who">
        <b>{msg.role === 'user' ? 'you' : 'assistant'}</b>
        {msg.sources && msg.sources.length > 0 && <span className="tag">{msg.sources.length} sources</span>}
        {msg.tools && msg.tools.length > 0 && <span className="tag">{msg.tools.length} tool calls</span>}
      </div>
      {msg.tools && msg.tools.length > 0 && (
        <div className="tools-run">
          {msg.tools.map((t, i) => (
            <div key={i} className={'trow ' + (t.ok ? 'ok' : 'bad')}>
              <b>{esc(t.name)}</b>
              <span className="d">{esc(t.sum)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: md(msg.content) }} />
      {msg.images && msg.images.length > 0 && msg.images.map((src, i) => (
        <img key={i} src={src} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginTop: 6 }} />
      ))}
      {msg.sources && msg.sources.length > 0 && (
        <div className="cites">
          {msg.sources.map((s, n) => (
            <a key={n} className="cite" href={s.url} target="_blank" rel="noopener">[{n + 1}] {esc(s.title || s.url)}</a>
          ))}
        </div>
      )}
      <div className="acts">
        <button onClick={() => { navigator.clipboard.writeText(msg.content || ''); toastEl('copied'); }}>copy</button>
        {msg.role === 'assistant' ? (
          <>
            <button onClick={() => regen(idx)}>regen</button>
            <button onClick={() => speak(msg.content)}>read</button>
            <button onClick={() => dispatch({ type: 'DEL_MESSAGE', chatId, idx })}>delete</button>
          </>
        ) : (
          <>
            <button onClick={() => { const t = prompt('edit', msg.content); if (t != null) dispatch({ type: 'EDIT_MESSAGE', chatId, idx, content: t }); }}>edit</button>
            <button onClick={() => dispatch({ type: 'DEL_MESSAGE', chatId, idx })}>delete</button>
          </>
        )}
      </div>
    </div>
  );
}

// ============ Modals ============

function SetupModal({ state, dispatch, probe }: { state: AppState; dispatch: React.Dispatch<any>; probe: () => void }) {
  const [cfg, setCfg] = useState({ ...state.cfg, keys: { ...state.cfg.keys } });
  const [testResult, setTestResult] = useState<{ text: string; ok: boolean } | null>(null);

  async function test() {
    setTestResult({ text: 'testing...', ok: false });
    const out: string[] = [];
    try {
      const r = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/models?per_page=1', { headers: cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {} });
      out.push('direct: ' + (r.ok ? 'ok' : 'http ' + r.status));
    } catch { out.push('direct: blocked'); }
    if (cfg.proxy) {
      try {
        const r = await fetch(cfg.proxy.replace(/\/$/, '') + '/' + cfg.baseUrl.replace(/\/$/, '') + '/models?per_page=1', { headers: cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {} });
        out.push('proxy: ' + (r.ok ? 'ok' : 'http ' + r.status));
      } catch { out.push('proxy: unreachable'); }
    } else { out.push('proxy: not set'); }
    const good = out.some(x => x.endsWith('ok'));
    setTestResult({ text: out.join('\n') + (good ? '\nworks - save it.' : '\nrun proxy.mjs and retest.'), ok: good });
  }

  function save() {
    dispatch({ type: 'SET_CFG', payload: cfg });
    dispatch({ type: 'SET_MODAL', modal: null });
    probe();
    toastEl('saved');
  }

  return (
    <>
      <h3>Setup</h3>
      <div className="sub">stored only in this browser</div>
      <div className="field"><label>Featherless API key</label><input type="password" value={cfg.key} onChange={e => setCfg({ ...cfg, key: e.target.value })} placeholder="sk-..." /></div>
      <div className="field"><label>base url</label><input value={cfg.baseUrl} onChange={e => setCfg({ ...cfg, baseUrl: e.target.value })} /></div>
      <div className="field"><label>proxy (needed on sandboxed pages)</label><input value={cfg.proxy} onChange={e => setCfg({ ...cfg, proxy: e.target.value })} placeholder="http://localhost:8787/" /></div>
      <div className="row">
        <button className="btn" onClick={() => setCfg({ ...cfg, proxy: 'http://localhost:8787/' })}>use local proxy</button>
        <button className="btn" onClick={test}>test connection</button>
        <button className="btn" onClick={() => dispatch({ type: 'SET_MODAL', modal: 'docs' })}>docs</button>
      </div>
      {testResult && <div className={'tres ' + (testResult.ok ? 'good' : 'bad')}>{testResult.text}</div>}
      <div className="field" style={{ marginTop: 9 }}><label>system prompt</label><textarea value={cfg.system} onChange={e => setCfg({ ...cfg, system: e.target.value })} style={{ height: 52 }} /></div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}><label>temp {cfg.temp}</label><input type="range" min="0" max="2" step="0.05" value={cfg.temp} onChange={e => setCfg({ ...cfg, temp: parseFloat(e.target.value) })} /></div>
        <div className="field" style={{ flex: 1 }}><label>max tokens</label><input type="number" value={cfg.maxTokens} onChange={e => setCfg({ ...cfg, maxTokens: parseInt(e.target.value) || 2048 })} /></div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}><label>queries per search</label><input type="number" min="1" max="8" value={cfg.nQueries} onChange={e => setCfg({ ...cfg, nQueries: Math.min(8, Math.max(1, parseInt(e.target.value) || 4)) })} /></div>
        <div className="field" style={{ flex: 1 }}><label>results kept</label><input type="number" min="1" max="20" value={cfg.topK} onChange={e => setCfg({ ...cfg, topK: Math.min(20, Math.max(1, parseInt(e.target.value) || 6)) })} /></div>
      </div>
      <div className="sw">read replies aloud<input type="checkbox" checked={cfg.tts} onChange={e => setCfg({ ...cfg, tts: e.target.checked })} /></div>
      <h3 style={{ marginTop: 12 }}>search keys</h3>
      <div className="field"><label>exa</label><input value={cfg.keys.exa} onChange={e => setCfg({ ...cfg, keys: { ...cfg.keys, exa: e.target.value } })} /></div>
      <div className="field"><label>tavily</label><input value={cfg.keys.tavily} onChange={e => setCfg({ ...cfg, keys: { ...cfg.keys, tavily: e.target.value } })} /></div>
      <div className="field"><label>brave</label><input value={cfg.keys.brave} onChange={e => setCfg({ ...cfg, keys: { ...cfg.keys, brave: e.target.value } })} /></div>
      <div className="field"><label>github token</label><input value={cfg.keys.github} onChange={e => setCfg({ ...cfg, keys: { ...cfg.keys, github: e.target.value } })} /></div>
      <div className="field"><label>searxng url</label><input value={cfg.keys.searxUrl} onChange={e => setCfg({ ...cfg, keys: { ...cfg.keys, searxUrl: e.target.value } })} /></div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn pri" onClick={save}>save</button>
        <button className="btn" onClick={() => dispatch({ type: 'SET_MODAL', modal: null })}>close</button>
      </div>
    </>
  );
}

function DocsModal() {
  const proxyCode = `// proxy.mjs - node proxy.mjs
import http from 'node:http';
const ALLOW=['api.featherless.ai','api.exa.ai','api.tavily.com',
 'api.github.com','r.jina.ai','api.search.brave.com','en.wikipedia.org','image.pollinations.ai'];
http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');
 res.setHeader('Access-Control-Allow-Headers','*');
 res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
 if(req.method==='OPTIONS')return res.end();
 const target=decodeURIComponent(req.url.slice(1));
 let u;try{u=new URL(target)}catch(e){res.statusCode=400;return res.end('bad url')}
 if(!ALLOW.includes(u.hostname)){res.statusCode=403;return res.end('host not allowed')}
 const b=[];for await(const c of req)b.push(c);
 const r=await fetch(target,{method:req.method,
   headers:{'content-type':req.headers['content-type']||'application/json',
            ...(req.headers.authorization?{authorization:req.headers.authorization}:{}),
            ...(req.headers['x-api-key']?{'x-api-key':req.headers['x-api-key']}:{})},
   body:req.method==='GET'?undefined:Buffer.concat(b)});
 res.writeHead(r.status,{'content-type':r.headers.get('content-type')||'text/plain'});
 for await(const c of r.body)res.write(c);res.end();
}).listen(8787,()=>console.log('proxy on 8787'));`;

  return (
    <>
      <h3>Get it online</h3>
      <div className="sub">run the proxy, point the proxy field at it</div>
      <pre className="snip">{proxyCode}</pre>
      <div className="row">
        <button className="btn pri" onClick={() => { navigator.clipboard.writeText(proxyCode); toastEl('copied'); }}>copy</button>
        <button className="btn" onClick={() => { }}>close</button>
      </div>
    </>
  );
}

function ModelsModal({ state, dispatch, loadModels }: { state: AppState; dispatch: React.Dispatch<any>; loadModels: () => void }) {
  const [search, setSearch] = useState('');
  const [pickFor, setPickFor] = useState<'main' | 'search'>('main');
  const [customId, setCustomId] = useState('');

  const filtered = state.models.filter(m => !search || m.id.toLowerCase().includes(search.toLowerCase()));
  const current = pickFor === 'main' ? (state.cfg.model) : state.cfg.searchModel;
  const favs = filtered.filter(m => state.cfg.favs.includes(m.id));
  const recents = state.cfg.recents.filter(id => !state.cfg.favs.includes(id)).map(id => state.models.find(m => m.id === id)).filter((m): m is ModelInfo => !!m && (!search || m.id.toLowerCase().includes(search.toLowerCase())));
  const rest = filtered.filter(m => !state.cfg.favs.includes(m.id) && !state.cfg.recents.includes(m.id)).slice(0, 250);

  function setModel(id: string) {
    if (pickFor === 'main') dispatch({ type: 'SET_CFG', payload: { model: id, recents: [id, ...state.cfg.recents.filter(r => r !== id)].slice(0, 8) } });
    else dispatch({ type: 'SET_CFG', payload: { searchModel: id } });
    dispatch({ type: 'SET_MODAL', modal: null });
    toastEl('model set');
  }

  return (
    <>
      <h3>{pickFor === 'search' ? 'Search model' : 'Chat model'}</h3>
      <div className="sub">star favourites for the top of the list</div>
      <div className="row">
        <input placeholder="filter" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn" onClick={loadModels}>refresh</button>
      </div>
      <label className="mini" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={!state.cfg.onlyPlan} onChange={e => { dispatch({ type: 'SET_CFG', payload: { onlyPlan: !e.target.checked } }); loadModels(); }} />
        include off-plan models
      </label>
      <div className="row" style={{ marginBottom: 6 }}>
        <input placeholder="or paste any model id" value={customId} onChange={e => setCustomId(e.target.value)} />
        <button className="btn" onClick={() => { if (customId.trim()) setModel(customId.trim()); }}>set</button>
      </div>
      <div className="modes" style={{ marginBottom: 8 }}>
        <button className={pickFor === 'main' ? 'on' : ''} onClick={() => setPickFor('main')}>main model</button>
        <button className={pickFor === 'search' ? 'on' : ''} onClick={() => setPickFor('search')}>search model</button>
      </div>
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {favs.length > 0 && <><div className="grouplbl">favourites</div>{favs.map(m => <ModelRow key={m.id} m={m} active={m.id === current} fav={true} onSelect={() => setModel(m.id)} onFav={() => dispatch({ type: 'SET_CFG', payload: { favs: state.cfg.favs.filter(x => x !== m.id) } })} />)}</>}
        {recents.length > 0 && <><div className="grouplbl">recent</div>{recents.slice(0, 5).map(m => <ModelRow key={m.id} m={m} active={m.id === current} fav={false} onSelect={() => setModel(m.id)} onFav={() => dispatch({ type: 'SET_CFG', payload: { favs: [...state.cfg.favs, m.id] } })} />)}</>}
        {favs.length === 0 && rest.length === 0 && <div className="grouplbl">{state.cfg.key ? 'no models' : 'add a key'}</div>}
        {rest.map(m => <ModelRow key={m.id} m={m} active={m.id === current} fav={false} onSelect={() => setModel(m.id)} onFav={() => dispatch({ type: 'SET_CFG', payload: { favs: [...state.cfg.favs, m.id] } })} />)}
      </div>
      <button className="btn" style={{ marginTop: 8 }} onClick={() => dispatch({ type: 'SET_MODAL', modal: null })}>Close</button>
    </>
  );
}

function ModelRow({ m, active, fav, onSelect, onFav }: { m: ModelInfo; active: boolean; fav: boolean; onSelect: () => void; onFav: () => void }) {
  return (
    <div className={'mrow' + (active ? ' on' : '') + (m.avail === false ? ' gone' : '')} onClick={onSelect}>
      <span className={'star' + (fav ? ' on' : '')} onClick={e => { e.stopPropagation(); onFav(); }}>{fav ? '★' : '☆'}</span>
      <span className="mid">{esc(m.id)}</span>
      {m.ctx && <span className="badge">{Math.round(m.ctx / 1000)}k</span>}
      {m.vision && <span className="badge">vision</span>}
      {m.avail === false && <span className="badge warn">off plan</span>}
    </div>
  );
}

function HelpModal() {
  const shortcuts = [
    ['new chat', 'ctrl+N'],
    ['toggle web search', 'ctrl+K'],
    ['toggle agent mode', 'ctrl+J'],
    ['prompt library', 'ctrl+P'],
    ['memory', 'ctrl+M'],
    ['this panel', '?'],
    ['send / stop', 'enter'],
    ['newline', 'shift+enter'],
  ];
  return (
    <>
      <h3>Shortcuts</h3>
      <div className="sub">keyboard and gestures</div>
      {shortcuts.map(([desc, key]) => (
        <div key={key} className="kbd"><span>{desc}</span><code>{key}</code></div>
      ))}
      <p style={{ fontSize: 11, color: 'var(--mut)', marginTop: 8 }}>right-click a chat to pin, branch, rename or delete.</p>
      <div className="row" style={{ marginTop: 8 }}><button className="btn pri" onClick={() => { }}>close</button></div>
    </>
  );
}

function MemoryModal({ state, dispatch }: { state: AppState; dispatch: React.Dispatch<any> }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  return (
    <>
      <h3>Memory</h3>
      <div className="sub">facts the agent and you keep across chats</div>
      <div className="row" style={{ marginBottom: 8 }}>
        <input placeholder="key" value={key} onChange={e => setKey(e.target.value)} />
        <input placeholder="value" value={value} onChange={e => setValue(e.target.value)} />
        <button className="btn" onClick={() => {
          if (key.trim()) {
            dispatch({ type: 'ADD_MEM', entry: { id: uid(), k: key.trim(), v: value.trim(), src: 'manual', ts: Date.now() } });
            setKey(''); setValue('');
          }
        }}>add</button>
      </div>
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {state.mem.length === 0 && <div className="grouplbl">nothing stored</div>}
        {state.mem.map(m => (
          <div key={m.id} className="mem">
            <div className="mk">{esc(m.k)} <span style={{ color: '#6d6862' }}>({m.src})</span></div>
            <div>{esc(m.v)}</div>
            <div className="ma">
              <button onClick={() => dispatch({ type: 'DEL_MEM', id: m.id })}>delete</button>
            </div>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}><button className="btn" onClick={() => dispatch({ type: 'SET_MODAL', modal: null })}>close</button></div>
    </>
  );
}

function PromptsModal({ state, dispatch }: { state: AppState; dispatch: React.Dispatch<any> }) {
  const [title, setTitle] = useState('');
  const [cat, setCat] = useState('');
  const [body, setBody] = useState('');
  return (
    <>
      <h3>Prompt library</h3>
      <div className="sub">click to load into the system prompt</div>
      <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
        {state.prompts.length === 0 && <div className="grouplbl">empty</div>}
        {state.prompts.map(p => (
          <div key={p.id} className="pl" onClick={() => { dispatch({ type: 'SET_CFG', payload: { system: p.text } }); toastEl('system prompt set'); dispatch({ type: 'SET_MODAL', modal: null }); }}
            onContextMenu={e => { e.preventDefault(); dispatch({ type: 'DEL_PROMPT', id: p.id }); }}>
            <div className="pt">{esc(p.title)}</div>
            <div className="pc">{esc(p.cat || 'custom')}</div>
          </div>
        ))}
      </div>
      <div className="row"><input placeholder="title" value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="row" style={{ marginTop: 4 }}>
        <input placeholder="category" value={cat} onChange={e => setCat(e.target.value)} />
        <input placeholder="body" value={body} onChange={e => setBody(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn pri" onClick={() => {
          if (title.trim()) {
            dispatch({ type: 'ADD_PROMPT', p: { id: uid(), title: title.trim(), text: body.trim(), cat: cat.trim() || 'custom' } } as any);
            setTitle(''); setCat(''); setBody('');
          }
        }}>add</button>
        <button className="btn" onClick={() => dispatch({ type: 'SET_MODAL', modal: null })}>close</button>
      </div>
    </>
  );
}

function DorksModal({ doSearch, dispatch }: { doSearch: (q: string) => void; dispatch: React.Dispatch<any> }) {
  const [site, setSite] = useState('');
  const [filetype, setFiletype] = useState('');
  const [inurl, setInurl] = useState('');
  const [intitle, setIntitle] = useState('');
  const [excludeSite, setExcludeSite] = useState('');
  const [keywords, setKeywords] = useState('');

  function build() {
    const p: string[] = [];
    if (site) p.push('site:' + site);
    if (filetype) p.push('filetype:' + filetype);
    if (inurl) p.push('inurl:' + inurl);
    if (intitle) p.push('intitle:' + intitle);
    if (excludeSite) p.push('-site:' + excludeSite);
    if (keywords) p.push(keywords);
    return p.join(' ');
  }

  return (
    <>
      <h3>Dork builder</h3>
      <div className="sub">compose then run</div>
      <div className="field"><label>site</label><input placeholder="github.com" value={site} onChange={e => setSite(e.target.value)} /></div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}><label>filetype</label><input value={filetype} onChange={e => setFiletype(e.target.value)} /></div>
        <div className="field" style={{ flex: 1 }}><label>in url</label><input value={inurl} onChange={e => setInurl(e.target.value)} /></div>
      </div>
      <div className="field"><label>intitle</label><input value={intitle} onChange={e => setIntitle(e.target.value)} /></div>
      <div className="field"><label>exclude site</label><input value={excludeSite} onChange={e => setExcludeSite(e.target.value)} /></div>
      <div className="field"><label>keywords</label><input value={keywords} onChange={e => setKeywords(e.target.value)} /></div>
      <div className="row">
        <button className="btn pri" onClick={() => { const q = build(); dispatch({ type: 'SET_MODAL', modal: null }); doSearch(q); }}>build and run</button>
        <button className="btn" onClick={() => { const t = document.querySelector('.composer textarea') as HTMLTextAreaElement; if (t) t.value = build(); dispatch({ type: 'SET_MODAL', modal: null }); }}>build only</button>
        <button className="btn" onClick={() => dispatch({ type: 'SET_MODAL', modal: null })}>close</button>
      </div>
    </>
  );
}
