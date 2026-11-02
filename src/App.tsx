import React, { useEffect, useRef, useState, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { useStore, esc, uid, type AppState, type Message, type StoreReturn } from './store';
import { llm, parseJSON, fetchAll, runTool, TOOL_DOCS, MODES, DORKS, countTok, api, hdr, netFetch, isNet, type ToolResult } from './tools';
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
    const html = node.innerHTML;
    // Display math $$...$$
    const displayReplaced = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => {
      try { return katex.renderToString(tex, { displayMode: true, throwOnError: false }); }
      catch { return _; }
    });
    // Inline math \(...\)
    const inlineReplaced = displayReplaced.replace(/\\\(([\s\S]*?)\\\)/g, (_, tex) => {
      try { return katex.renderToString(tex, { displayMode: false, throwOnError: false }); }
      catch { return _; }
    });
    node.innerHTML = inlineReplaced;
  } catch {}
}

function toast(msg: string) {
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
  const [toastMsg, setToastMsg] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const msgsRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 1500);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [state.chats, state.streaming]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); dispatch({ type: 'NEW_CHAT' }); }
      if (e.ctrlKey && e.key === 'k') { e.preventDefault(); dispatch({ type: 'SET_CFG', payload: { searchOn: !stateRef.current.cfg.searchOn } }); }
      if (e.ctrlKey && e.key === 'j') { e.preventDefault(); dispatch({ type: 'SET_CFG', payload: { agent: !stateRef.current.cfg.agent } }); }
      if (e.key === '?' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault(); dispatch({ type: 'SET_MODAL', modal: 'help' });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dispatch, stateRef]);

  // Probe network on mount
  useEffect(() => {
    probe();
  }, []);

  async function probe() {
    dispatch({ type: 'SET_NET', v: 'checking' });
    const cfg = stateRef.current.cfg;
    if (!cfg.key) { dispatch({ type: 'SET_NET', v: 'no-key' }); return; }
    try {
      const r = await fetch(api(cfg, 'models?per_page=1'), { headers: hdr(cfg) });
      if (r.ok) {
        dispatch({ type: 'SET_NET', v: 'direct' });
        dispatch({ type: 'SET_BANNER', banner: { msg: 'connected directly', ok: true } });
        setTimeout(() => dispatch({ type: 'SET_BANNER', banner: null }), 4000);
        // Fetch models
        const r2 = await fetch(api(cfg, 'models?per_page=200'), { headers: hdr(cfg) });
        if (r2.ok) {
          const j = await r2.json();
          const models = (j.data || j.models || []).map((m: { id?: string; name?: string }) => m.id || m.name || '').filter(Boolean);
          dispatch({ type: 'SET_MODELS', models });
        }
        return;
      }
    } catch {}
    dispatch({ type: 'SET_NET', v: 'down' });
    dispatch({ type: 'SET_BANNER', banner: { msg: 'cannot connect - check API key and URL in setup', ok: false } });
  }

  // Send message
  async function send() {
    const cfg = stateRef.current.cfg;
    const chat = stateRef.current.chats.find(c => c.id === stateRef.current.active);
    const input = inputRef.current;
    if (!input || !input.value.trim() || !chat) return;
    if (!cfg.model) { dispatch({ type: 'SET_MODAL', modal: 'models' }); return; }

    const text = input.value.trim();
    const images = [...stateRef.current.atts];
    input.value = '';
    dispatch({ type: 'CLEAR_ATTS' });

    // Add user message
    const userMsg: Message = { role: 'user', content: text, images: images.length ? images : undefined };
    dispatch({ type: 'ADD_MESSAGE', chatId: chat.id, msg: userMsg });

    // Auto-title
    if (chat.messages.length === 0 && chat.title === 'new chat') {
      const title = text.slice(0, 40);
      dispatch({ type: 'RENAME_CHAT', id: chat.id, title });
    }

    dispatch({ type: 'SET_STREAMING', v: true });

    // Build messages for API
    const allMsgs = buildMessages(stateRef.current, chat, userMsg);

    try {
      if (cfg.agent) {
        await agentLoop(chat.id, allMsgs, cfg);
      } else {
        const response = await llm(cfg, cfg.model, allMsgs, { temp: cfg.temp, max: cfg.maxTokens });
        const tok = countTok(text) + countTok(response);
        dispatch({ type: 'SET_CFG', payload: { tokens: cfg.tokens + tok } });
        const assistantMsg: Message = { role: 'assistant', content: response };
        dispatch({ type: 'ADD_MESSAGE', chatId: chat.id, msg: assistantMsg });
      }
    } catch (e: unknown) {
      const errMsg = isNet(e) ? 'Network error: ' + (e as Error).message : 'Error: ' + (e as Error).message;
      dispatch({ type: 'ADD_MESSAGE', chatId: chat.id, msg: { role: 'assistant', content: errMsg } });
    }
    dispatch({ type: 'SET_STREAMING', v: false });
  }

  function buildMessages(s: AppState, chat: { messages: Message[] }, newUserMsg?: Message) {
    const out: unknown[] = [];
    const sys: string[] = [s.cfg.system];
    if (s.mem.length) sys.push('Known facts about the user:\n' + s.mem.slice(0, 15).map(m => '- ' + m.k + ': ' + m.v).join('\n'));
    if (s.cfg.agent) sys.push('You can call tools. Reply with ONLY a JSON object, either {"tool":"name","args":{...}} to act, or {"final":"answer"} when done.\nTools:\n' + TOOL_DOCS);
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

    if (newUserMsg) {
      if (newUserMsg.images && newUserMsg.images.length) {
        const parts: unknown[] = [{ type: 'text', text: newUserMsg.content }];
        newUserMsg.images.forEach(u => parts.push({ type: 'image_url', image_url: { url: u } }));
        out.push({ role: 'user', content: parts });
      } else {
        out.push({ role: 'user', content: newUserMsg.content });
      }
    }
    return out;
  }

  async function agentLoop(chatId: string, msgs: unknown[], cfg: AppState['cfg']) {
    const maxIter = 12;
    const toolCalls: ToolResult[] = [];
    let currentMsgs = [...msgs];

    for (let i = 0; i < maxIter; i++) {
      const response = await llm(cfg, cfg.model, currentMsgs, { temp: cfg.temp, max: cfg.maxTokens });
      const parsed = parseJSON(response) as { tool?: string; args?: Record<string, string>; final?: string } | null;

      if (parsed?.final) {
        // Done
        const tok = countTok(response);
        dispatch({ type: 'SET_CFG', payload: { tokens: cfg.tokens + tok } });
        const assistantMsg: Message = { role: 'assistant', content: parsed.final, tools: toolCalls.length ? toolCalls : undefined };
        dispatch({ type: 'ADD_MESSAGE', chatId, msg: assistantMsg });
        return;
      }

      if (parsed?.tool) {
        // Run tool
        const result = await runTool(parsed.tool, parsed.args || {}, stateRef.current, dispatch);
        toolCalls.push({ name: parsed.tool, sum: result.slice(0, 100), ok: !result.startsWith('TOOL ERROR') });
        dispatch({ type: 'SET_MSG_TOOLS', chatId, idx: -1, tools: [...toolCalls] });
        currentMsgs.push({ role: 'assistant', content: response });
        currentMsgs.push({ role: 'user', content: 'Tool result:\n' + result });
      } else {
        // Plain text response
        const tok = countTok(response);
        dispatch({ type: 'SET_CFG', payload: { tokens: cfg.tokens + tok } });
        const assistantMsg: Message = { role: 'assistant', content: response, tools: toolCalls.length ? toolCalls : undefined };
        dispatch({ type: 'ADD_MESSAGE', chatId, msg: assistantMsg });
        return;
      }
    }
    // Max iterations reached
    dispatch({ type: 'ADD_MESSAGE', chatId, msg: { role: 'assistant', content: 'Max tool iterations reached.', tools: toolCalls } });
  }

  // Search
  async function doSearch(query: string) {
    if (!query.trim()) return;
    const s = stateRef.current;
    let queries = [query];
    // If expand mode, ask model to generate queries
    if (s.cfg.expand && s.cfg.searchModel) {
      try {
        const prompt = `Generate ${s.cfg.nQueries} diverse search queries for: "${query}". Return JSON array of strings only.`;
        const resp = await llm(s.cfg, s.cfg.searchModel, [{ role: 'user', content: prompt }], { max: 400 });
        const parsed = parseJSON(resp);
        if (Array.isArray(parsed) && parsed.length) queries = parsed.map(String);
      } catch {}
    }
    const results = await fetchAll(s, queries);

    // If rank mode, ask model to score
    if (s.cfg.rank && s.cfg.searchModel && results.length) {
      try {
        const prompt = `Score these results 0-10 for relevance to "${query}". Return JSON array of {url, score, note}.\n` +
          results.map((r, i) => `[${i}] ${r.title} ${r.url}`).join('\n');
        const resp = await llm(s.cfg, s.cfg.searchModel, [{ role: 'user', content: prompt }], { max: 600 });
        const parsed = parseJSON(resp);
        if (Array.isArray(parsed)) {
          const scores = new Map(parsed.map((x: { url: string; score: number; note?: string }) => [x.url, x]));
          results.forEach(r => {
            const s = scores.get(r.url);
            if (s) { r.note = s.note; }
          });
          results.sort((a, b) => (scores.get(b.url)?.score || 0) - (scores.get(a.url)?.score || 0));
        }
        dispatch({ type: 'SET_SUMMARY', v: `Found ${results.length} results for "${query}" across ${queries.length} queries` });
      } catch {}
    }
    dispatch({ type: 'SET_RESULTS', results });
  }

  // Speak
  function speak(text: string) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(u);
  }

  // Export
  function exportChat() {
    const chat = stateRef.current.chats.find(c => c.id === stateRef.current.active);
    if (!chat) return;
    const text = chat.messages.map(m => `## ${m.role}\n${m.content}`).join('\n\n---\n\n');
    const blob = new Blob([text], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (chat.title || 'chat') + '.md';
    a.click();
  }

  // Share
  function sharePayload() {
    const chat = stateRef.current.chats.find(c => c.id === stateRef.current.active);
    if (!chat) return;
    const text = chat.messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
    navigator.clipboard.writeText(text);
    showToast('copied to clipboard');
  }

  // File attachment
  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(f => {
      const reader = new FileReader();
      reader.onload = () => {
        dispatch({ type: 'ADD_ATT', src: reader.result as string });
      };
      reader.readAsDataURL(f);
    });
    e.target.value = '';
  }

  // Context menu for chats
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; chatId: string } | null>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => setCtxMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [ctxMenu]);

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
        <button onClick={() => dispatch({ type: 'SET_MODAL', modal: 'memory' })} title="Memory">{Icons.brain}</button>
        <button onClick={() => dispatch({ type: 'SET_MODAL', modal: 'prompts' })} title="Prompt library">{Icons.list}</button>
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
          {state.tab === 'results' && <ResultsTab state={state} dispatch={dispatch} doSearch={doSearch} showToast={showToast} />}
          {state.tab === 'saved' && <SavedTab state={state} dispatch={dispatch} showToast={showToast} />}
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
          <button className={'tbtn' + (state.cfg.agent ? ' on' : '')} onClick={() => dispatch({ type: 'SET_CFG', payload: { agent: !state.cfg.agent } })} title="Agent mode (Ctrl+J)">{Icons.robot}</button>
          <button className="tbtn" onClick={() => dispatch({ type: 'SET_MODAL', modal: 'dorks' })} title="Dork builder">{Icons.code}</button>
          <button className="tbtn" onClick={sharePayload} title="Share">{Icons.share}</button>
          <button className="tbtn" onClick={exportChat} title="Export">{Icons.download}</button>
        </div>

        {state.banner && (
          <div className={'banner' + (state.banner.ok ? ' ok' : '')}>
            <span className="dot" />
            <span className="g">{state.banner.msg}</span>
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
              <MessageView key={i} msg={msg} chatId={activeChat.id} idx={i} dispatch={dispatch} showToast={showToast} speak={speak} />
            ))
          )}
          {state.streaming && (
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
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          <div className="cbar">
            <button className="tbtn" onClick={() => fileRef.current?.click()} title="Attach image">{Icons.paperclip}</button>
            <button className="tbtn" onClick={() => {
              const chat = stateRef.current.chats.find(c => c.id === stateRef.current.active);
              if (chat) {
                const last = chat.messages.filter(m => m.role === 'assistant').pop();
                if (last) speak(last.content);
              }
            }} title="Read aloud">{Icons.volume}</button>
            <span className="hint">
              {state.cfg.agent ? 'agent on — tools: search, read, github, memory, code, image' :
               state.cfg.searchOn ? 'search via ' + (state.cfg.searchModel || 'no model') + ' — mode: ' + state.cfg.mode : ''}
            </span>
            <button className={'send' + (state.streaming ? ' stop' : '')} onClick={() => {
              if (state.streaming) { ctrlRef.current?.abort(); dispatch({ type: 'SET_STREAMING', v: false }); }
              else send();
            }}>
              {state.streaming ? 'Stop' : 'Send'}
            </button>
          </div>
          <input type="file" ref={fileRef} accept="image/*" multiple hidden onChange={handleFiles} />
        </div>
      </main>

      {/* Context menu */}
      {ctxMenu && (
        <div className="ctx" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={e => e.stopPropagation()}>
          <CtxMenuItems chatId={ctxMenu.chatId} dispatch={dispatch} onClose={() => setCtxMenu(null)} />
        </div>
      )}

      {/* Modal */}
      {state.modal && (
        <div className="modal" onClick={() => dispatch({ type: 'SET_MODAL', modal: null })}>
          <div className="box" onClick={e => e.stopPropagation()}>
            {state.modal === 'setup' && <SetupModal state={state} dispatch={dispatch} probe={probe} />}
            {state.modal === 'models' && <ModelsModal state={state} dispatch={dispatch} />}
            {state.modal === 'help' && <HelpModal />}
            {state.modal === 'memory' && <MemoryModal state={state} dispatch={dispatch} />}
            {state.modal === 'prompts' && <PromptsModal state={state} dispatch={dispatch} showToast={showToast} />}
            {state.modal === 'dorks' && <DorksModal doSearch={doSearch} dispatch={dispatch} />}
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}

// Sub-components

function ChatsTab({ state, dispatch, setCtxMenu }: { state: AppState; dispatch: React.Dispatch<any>; setCtxMenu: (v: { x: number; y: number; chatId: string } | null) => void }) {
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

function CtxMenuItems({ chatId, dispatch, onClose }: { chatId: string; dispatch: React.Dispatch<any>; onClose: () => void }) {
  const chat = JSON.parse(localStorage.getItem('vf2.chats') || '[]').find((c: any) => c.id === chatId);
  return (
    <>
      <button onClick={() => { dispatch({ type: 'PIN_CHAT', id: chatId }); onClose(); }}>{chat?.pin ? 'unpin' : 'pin'}</button>
      <button onClick={() => { dispatch({ type: 'BRANCH_CHAT', id: chatId }); onClose(); toast('branched'); }}>branch</button>
      <button onClick={() => { const t = prompt('title', chat?.title); if (t) { dispatch({ type: 'RENAME_CHAT', id: chatId, title: t }); } onClose(); }}>rename</button>
      <button onClick={() => { dispatch({ type: 'DEL_CHAT', id: chatId }); onClose(); }}>delete</button>
    </>
  );
}

function ResultsTab({ state, dispatch, doSearch, showToast }: { state: AppState; dispatch: React.Dispatch<any>; doSearch: (q: string) => void; showToast: (m: string) => void }) {
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
        <input id="rq" placeholder="query or dork" defaultValue={state.rq} onKeyDown={e => { if (e.key === 'Enter') doSearch((e.target as HTMLInputElement).value); }} />
        <button className="btn" style={{ flex: '0 0 auto' }} onClick={() => { const el = document.getElementById('rq') as HTMLInputElement; doSearch(el?.value || ''); }}>go</button>
      </div>
      <DorkButtons apply={(v) => { dispatch({ type: 'SET_RQ', v }); const el = document.getElementById('rq') as HTMLInputElement; if (el) el.value = v; doSearch(v); }} />
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
            <button onClick={() => showToast('reading...')}>read</button>
            <button onClick={() => { dispatch({ type: 'ADD_SAVED', item: r }); showToast('saved'); }}>save</button>
            <button onClick={() => { const t = document.querySelector('textarea') as HTMLTextAreaElement; if (t) { t.value += (t.value ? '\n' : '') + r.url + ' '; t.focus(); } }}>use</button>
          </div>
        </div>
      ))}
      {state.results.length > 0 && <button className="btn" onClick={() => dispatch({ type: 'CLEAR_RESULTS' })}>clear results</button>}
    </>
  );
}

function SavedTab({ state, dispatch, showToast }: { state: AppState; dispatch: React.Dispatch<any>; showToast: (m: string) => void }) {
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
            <button onClick={() => { navigator.clipboard.writeText(r.title + '\n' + r.url + '\n' + (r.text || '')); showToast('copied'); }}>copy</button>
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

function MessageView({ msg, chatId, idx, dispatch, showToast, speak }: { msg: Message; chatId: string; idx: number; dispatch: React.Dispatch<any>; showToast: (m: string) => void; speak: (t: string) => void }) {
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
        <button onClick={() => { navigator.clipboard.writeText(msg.content || ''); showToast('copied'); }}>copy</button>
        {msg.role === 'assistant' ? (
          <>
            <button onClick={() => speak(msg.content)}>read</button>
            <button onClick={() => { dispatch({ type: 'DEL_MESSAGE', chatId, idx }); }}>delete</button>
          </>
        ) : (
          <>
            <button onClick={() => { const t = prompt('edit', msg.content); if (t != null) dispatch({ type: 'EDIT_MESSAGE', chatId, idx, content: t }); }}>edit</button>
            <button onClick={() => { dispatch({ type: 'DEL_MESSAGE', chatId, idx }); }}>delete</button>
          </>
        )}
      </div>
    </div>
  );
}

// Modals

function SetupModal({ state, dispatch, probe }: { state: AppState; dispatch: React.Dispatch<any>; probe: () => void }) {
  const [localCfg, setLocalCfg] = useState({ ...state.cfg });
  return (
    <>
      <h3>Setup</h3>
      <div className="sub">Configure your API endpoint and keys</div>
      <div className="field">
        <label>API Base URL</label>
        <input value={localCfg.baseUrl} onChange={e => setLocalCfg({ ...localCfg, baseUrl: e.target.value })} />
      </div>
      <div className="field">
        <label>API Key</label>
        <input type="password" value={localCfg.key} onChange={e => setLocalCfg({ ...localCfg, key: e.target.value })} placeholder="your-api-key" />
      </div>
      <div className="field">
        <label>Proxy URL (optional, for CORS)</label>
        <input value={localCfg.proxy} onChange={e => setLocalCfg({ ...localCfg, proxy: e.target.value })} placeholder="https://your-cors-proxy/" />
      </div>
      <div className="field">
        <label>System Prompt</label>
        <textarea value={localCfg.system} onChange={e => setLocalCfg({ ...localCfg, system: e.target.value })} style={{ height: 80 }} />
      </div>
      <div className="row" style={{ gap: 6 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Temperature</label>
          <input type="number" step="0.1" min="0" max="2" value={localCfg.temp} onChange={e => setLocalCfg({ ...localCfg, temp: parseFloat(e.target.value) })} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Max Tokens</label>
          <input type="number" value={localCfg.maxTokens} onChange={e => setLocalCfg({ ...localCfg, maxTokens: parseInt(e.target.value) })} />
        </div>
      </div>
      <h3 style={{ marginTop: 12 }}>Search API Keys</h3>
      <div className="field">
        <label>Exa API Key</label>
        <input value={localCfg.keys.exa} onChange={e => setLocalCfg({ ...localCfg, keys: { ...localCfg.keys, exa: e.target.value } })} />
      </div>
      <div className="field">
        <label>Tavily API Key</label>
        <input value={localCfg.keys.tavily} onChange={e => setLocalCfg({ ...localCfg, keys: { ...localCfg.keys, tavily: e.target.value } })} />
      </div>
      <div className="field">
        <label>Brave API Key</label>
        <input value={localCfg.keys.brave} onChange={e => setLocalCfg({ ...localCfg, keys: { ...localCfg.keys, brave: e.target.value } })} />
      </div>
      <div className="field">
        <label>GitHub Token (optional)</label>
        <input value={localCfg.keys.github} onChange={e => setLocalCfg({ ...localCfg, keys: { ...localCfg.keys, github: e.target.value } })} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <button className="btn pri" onClick={() => { dispatch({ type: 'SET_CFG', payload: localCfg }); probe(); dispatch({ type: 'SET_MODAL', modal: null }); }}>Save & Test</button>
        <button className="btn" onClick={() => dispatch({ type: 'SET_MODAL', modal: null })}>Cancel</button>
      </div>
    </>
  );
}

function ModelsModal({ state, dispatch }: { state: AppState; dispatch: React.Dispatch<any> }) {
  const [search, setSearch] = useState('');
  const [pickFor, setPickFor] = useState<'main' | 'search'>('main');
  const filtered = state.models.filter(m => !search || m.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <h3>Choose Model</h3>
      <div className="sub">{state.models.length} models available</div>
      <div className="modes" style={{ marginBottom: 8 }}>
        <button className={pickFor === 'main' ? 'on' : ''} onClick={() => setPickFor('main')}>main model</button>
        <button className={pickFor === 'search' ? 'on' : ''} onClick={() => setPickFor('search')}>search model</button>
      </div>
      <input placeholder="Filter models..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {filtered.slice(0, 50).map(m => {
          const current = pickFor === 'main' ? state.cfg.model : state.cfg.searchModel;
          const isFav = state.cfg.favs.includes(m);
          return (
            <div key={m} className={'mrow' + (m === current ? ' on' : '')} onClick={() => {
              if (pickFor === 'main') dispatch({ type: 'SET_CFG', payload: { model: m, recents: [m, ...state.cfg.recents.filter(r => r !== m)].slice(0, 10) } });
              else dispatch({ type: 'SET_CFG', payload: { searchModel: m } });
            }}>
              <span className="mid">{m}</span>
              <button className={'star' + (isFav ? ' on' : '')} onClick={e => {
                e.stopPropagation();
                const favs = isFav ? state.cfg.favs.filter(f => f !== m) : [...state.cfg.favs, m];
                dispatch({ type: 'SET_CFG', payload: { favs } });
              }}>★</button>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="grouplbl">no models found — check setup</div>}
      </div>
      <button className="btn" style={{ marginTop: 8 }} onClick={() => dispatch({ type: 'SET_MODAL', modal: null })}>Close</button>
    </>
  );
}

function HelpModal() {
  const shortcuts = [
    ['Ctrl+N', 'New chat'],
    ['Ctrl+K', 'Toggle web search'],
    ['Ctrl+J', 'Toggle agent mode'],
    ['Enter', 'Send message'],
    ['Shift+Enter', 'New line'],
    ['?', 'Show shortcuts'],
  ];
  return (
    <>
      <h3>Keyboard Shortcuts</h3>
      <div className="sub">Quick reference</div>
      {shortcuts.map(([key, desc]) => (
        <div key={key} className="kbd">
          <span>{desc}</span>
          <code>{key}</code>
        </div>
      ))}
      <h3 style={{ marginTop: 12 }}>Features</h3>
      <div className="sub">
        • Agent mode: model uses tools (search, read pages, GitHub, memory, code, images)<br />
        • Web search: multi-provider search with query expansion and result ranking<br />
        • Memory: persistent facts the model can recall<br />
        • Prompt library: save and reuse prompts<br />
        • Dork builder: advanced search operators<br />
        • Export: download chats as markdown
      </div>
      <button className="btn" style={{ marginTop: 8 }} onClick={() => { }}>Close</button>
    </>
  );
}

function MemoryModal({ state, dispatch }: { state: AppState; dispatch: React.Dispatch<any> }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  return (
    <>
      <h3>Memory</h3>
      <div className="sub">Persistent facts the agent can recall ({state.mem.length} entries)</div>
      <div className="row" style={{ marginBottom: 8 }}>
        <input placeholder="key" value={key} onChange={e => setKey(e.target.value)} style={{ flex: 1 }} />
        <input placeholder="value" value={value} onChange={e => setValue(e.target.value)} style={{ flex: 2 }} />
        <button className="btn pri" onClick={() => {
          if (key) {
            dispatch({ type: 'ADD_MEM', entry: { id: uid(), k: key, v: value, src: 'manual', ts: Date.now() } });
            setKey(''); setValue('');
          }
        }}>Add</button>
      </div>
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {state.mem.map(m => (
          <div key={m.id} className="mem">
            <div className="mk">{esc(m.k)}</div>
            <div>{esc(m.v)}</div>
            <div className="ma">
              <button onClick={() => dispatch({ type: 'DEL_MEM', id: m.id })}>delete</button>
            </div>
          </div>
        ))}
        {state.mem.length === 0 && <div className="grouplbl">no memories yet</div>}
      </div>
      <button className="btn" style={{ marginTop: 8 }} onClick={() => dispatch({ type: 'SET_MODAL', modal: null })}>Close</button>
    </>
  );
}

function PromptsModal({ state, dispatch, showToast }: { state: AppState; dispatch: React.Dispatch<any>; showToast: (m: string) => void }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  return (
    <>
      <h3>Prompt Library</h3>
      <div className="sub">Save and reuse prompts</div>
      <div className="field">
        <input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <textarea placeholder="Prompt text..." value={text} onChange={e => setText(e.target.value)} style={{ height: 60 }} />
      </div>
      <button className="btn pri" onClick={() => {
        if (title && text) {
          dispatch({ type: 'ADD_PROMPT', p: { id: uid(), title, text } });
          setTitle(''); setText('');
          showToast('saved');
        }
      }}>Save Prompt</button>
      <div style={{ marginTop: 10, maxHeight: 250, overflowY: 'auto' }}>
        {state.prompts.map(p => (
          <div key={p.id} className="pl" onClick={() => {
            const t = document.querySelector('textarea') as HTMLTextAreaElement;
            if (t) { t.value = p.text; t.focus(); }
            dispatch({ type: 'SET_MODAL', modal: null });
          }}>
            <div className="pt">{esc(p.title)}</div>
            <div className="pc">{esc(p.text.slice(0, 80))}</div>
            <button className="btn sm" style={{ marginTop: 3 }} onClick={e => { e.stopPropagation(); dispatch({ type: 'DEL_PROMPT', id: p.id }); }}>delete</button>
          </div>
        ))}
      </div>
      <button className="btn" style={{ marginTop: 8 }} onClick={() => dispatch({ type: 'SET_MODAL', modal: null })}>Close</button>
    </>
  );
}

function DorksModal({ doSearch, dispatch }: { doSearch: (q: string) => void; dispatch: React.Dispatch<any> }) {
  return (
    <>
      <h3>Dork Builder</h3>
      <div className="sub">Click to insert search operators</div>
      <div className="dorks">
        {DORKS.map(([d, l]) => (
          <button key={l} title={d} onClick={() => {
            const t = document.querySelector('textarea') as HTMLTextAreaElement;
            if (t) { t.value += d; t.focus(); }
            dispatch({ type: 'SET_MODAL', modal: null });
          }}>{l}</button>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--mut)' }}>
        <p>Search operators let you target specific sites and content types:</p>
        <ul style={{ paddingLeft: 16 }}>
          <li><code>site:</code> — limit to a domain</li>
          <li><code>filetype:</code> — specific file types</li>
          <li><code>intitle:</code> — term must be in title</li>
          <li><code>inurl:</code> — term must be in URL</li>
          <li><code>"..."</code> — exact phrase match</li>
          <li><code>after:</code> — content after date</li>
        </ul>
      </div>
      <button className="btn" style={{ marginTop: 8 }} onClick={() => dispatch({ type: 'SET_MODAL', modal: null })}>Close</button>
    </>
  );
}
