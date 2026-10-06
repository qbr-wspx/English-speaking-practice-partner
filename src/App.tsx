import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ArrowUp, Check, Coffee, Hotel, Plane, ShoppingBag, MapPin, Briefcase, Users, Utensils, LayoutGrid, History, Settings, Plus, Mic, Square, Hand, Copy, Pencil, Trash2, ChevronLeft, RefreshCw } from "lucide-react";
import { Avatar2D } from "./components/Avatar2D";
import { SceneBackdrop } from "./components/SceneBackdrop";
import { ReviewSpotlight } from "./components/ReviewSpotlight";
import { SettingsDialog } from "./components/SettingsDialog";
import { ScenarioEditor } from "./components/ScenarioEditor";
import { StatusPill } from "./components/StatusPill";
import { Transcript } from "./components/Transcript";
import { useConversation } from "./hooks/useConversation";
import { useConversationStore } from "./store/conversation";
import { api } from "./lib/api";
import { defaultPreferences, type Preferences, type Scenario, type SessionDetail, type SessionSummary, type Review } from "./types";
const icons: Record<string, typeof Coffee> = { "cafe-ordering": Coffee, "restaurant-dining": Utensils, "hotel-checkin": Hotel, "airport-travel": Plane, "shopping-returns": ShoppingBag, "directions-transit": MapPin, "job-interview": Briefcase, "daily-social": Users };
function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem("lingo-preferences") || "{}");
    return { ...defaultPreferences, ...saved, voice: ["loongcally_v3", "loongemily_v3", "loongabby_v3", "loongannie_v3"].includes(saved.voice) ? saved.voice : defaultPreferences.voice, rate: typeof saved.rate === "number" ? Math.min(1.3, Math.max(0.7, saved.rate)) : 0.95, quality: saved.quality === "low" ? "low" : "standard" };
  } catch { return defaultPreferences; }
}
export default function App() {
  // The 2D avatar subscribes to audio energy directly, without repainting the entire UI.
  const state = useConversationStore(useShallow(value => ({ ...value, mouthLevel: 0 }))); const conversation = useConversation();
  const [page, setPage] = useState<"home" | "practice" | "history">("home");
  const [scenarios, setScenarios] = useState<Scenario[]>([]); const [selected, setSelected] = useState<Scenario | null>(null);
  const [level, setLevel] = useState("A2"); const [filter, setFilter] = useState("全部");
  const [preferences, setPreferences] = useState(readPreferences); const [settingsOpen, setSettingsOpen] = useState(false);
  const [editor, setEditor] = useState<{ initial: Scenario | null } | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]); const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [text, setText] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const [reviewBusy, setReviewBusy] = useState(false); const [health, setHealth] = useState<{ deepseek_configured: boolean; speech_configured: boolean } | null>(null);
  const [finishing, setFinishing] = useState(false); const [freshReviewId, setFreshReviewId] = useState<string | null>(null);
  const [inviteRequired, setInviteRequired] = useState(false); const [inviteCode, setInviteCode] = useState(""); const [inviteBusy, setInviteBusy] = useState(false);
  const active = Boolean(state.sessionId) || state.phase === "starting";
  const canSend = Boolean(state.sessionId) && ["listening", "text-ready", "error"].includes(state.phase);
  const loadScenarios = async () => {
    const items = await api<Scenario[]>("/api/scenarios"); setScenarios(items);
    setSelected(old => items.find(x => x.id === old?.id) || items.find(x => x.id === "cafe-ordering") || items[0]);
  };
  const loadSessions = async () => setSessions(await api<SessionSummary[]>("/api/sessions"));
  const boot = async () => {
    setLoading(true); setError("");
    try {
      const backend = await window.desktop?.startBackend();
      if (backend?.state === "needs-invite") { setInviteRequired(true); setError(""); return; }
      if (backend && backend.state !== "ready") throw new Error(backend.message);
      setInviteRequired(false);
      await loadScenarios(); setHealth(await api("/health")); await loadSessions();
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { void boot(); }, []);
  const updatePreferences = (value: Preferences) => { setPreferences(value); localStorage.setItem("lingo-preferences", JSON.stringify(value)); };
  const redeemInvite = async () => {
    if (!window.desktop?.redeemInvite || inviteBusy) return;
    setInviteBusy(true); setError("");
    try {
      const result = await window.desktop.redeemInvite(inviteCode);
      if (result.state !== "ready") throw new Error(result.message);
      setInviteCode(""); setInviteRequired(false); await boot();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "邀请码验证失败。"); }
    finally { setInviteBusy(false); }
  };
  const start = () => { if (!selected) return; setPage("practice"); setText(""); setError(""); void conversation.start(selected, level, preferences); };
  const showDetail = async (id: string) => { setError(""); try { setDetail(await api<SessionDetail>(`/api/sessions/${id}`)); } catch (e) { setError((e as Error).message); } };
  const generateReview = async (id: string) => {
    setReviewBusy(true); setError("");
    try { const review = await api<Review>(`/api/sessions/${id}/review`, { method: "POST" }); setDetail(old => old?.id === id ? { ...old, review } : old); }
    catch (e) { setError((e as Error).message); } finally { setReviewBusy(false); }
  };
  const finish = async () => {
    if (finishing) return; setFinishing(true);
    const id = await conversation.stop(); setFreshReviewId(id); setPage("history");
    try { await loadSessions(); if (id) { await showDetail(id); await generateReview(id); } } catch (e) { setError((e as Error).message); } finally { setFinishing(false); }
  };
  const removeScenario = async (scenario: Scenario) => {
    if (!window.confirm(`删除“${scenario.title_zh}”？已有练习记录会保留。`)) return;
    try { await api(`/api/scenarios/${scenario.id}`, { method: "DELETE" }); await loadScenarios(); } catch (e) { setError((e as Error).message); }
  };
  const copyScenario = async (scenario: Scenario) => {
    try { const copied = await api<Scenario>("/api/scenarios", { method: "POST", body: JSON.stringify({ ...scenario, title_zh: `${scenario.title_zh}（副本）`.slice(0, 100), level }) }); await loadScenarios(); setSelected(copied); setFilter("自定义"); } catch (e) { setError((e as Error).message); }
  };
  const removeSession = async (id: string) => {
    if (!window.confirm("删除这次练习及复盘？此操作无法撤销。")) return;
    try { await api(`/api/sessions/${id}`, { method: "DELETE" }); if (detail?.id === id) setDetail(null); await loadSessions(); } catch (e) { setError((e as Error).message); }
  };
  const repeat = async (item: SessionDetail) => {
    const existing = scenarios.find(x => x.id === item.scenario_id);
    if (existing) { setSelected(existing); setLevel(item.scenario?.level || "A2"); setPage("home"); }
    else if (item.scenario) {
      try { const restored = await api<Scenario>("/api/scenarios", { method: "POST", body: JSON.stringify({ ...item.scenario, level: item.scenario.level === "A2–B1" ? "A2" : item.scenario.level }) }); await loadScenarios(); setSelected(restored); setPage("home"); }
      catch (e) { setError((e as Error).message); }
    } else setError("原场景不可用，请从场景库选择练习。");
  };
  const visible = scenarios.filter(x => filter === "全部" || (filter === "自定义" ? x.source === "custom" : x.category === filter));
  const completed = state.progress.filter(x => x.completed).length;
  const send = () => { if (conversation.submitText(text)) setText(""); };
  return <main className="app-shell">
    <aside className="navigation">
      <div className="brand"><div className="brand-mark">L</div><div><strong>Lingo Studio</strong><span>英语口语陪练</span></div></div>
      <nav><button className={page !== "history" ? "selected" : ""} disabled={active} onClick={() => setPage("home")}><LayoutGrid size={19} />场景练习</button><button className={page === "history" ? "selected" : ""} disabled={active} onClick={() => { setPage("history"); void loadSessions().catch(e => setError(e.message)); }}><History size={19} />练习记录<span>{sessions.length || ""}</span></button></nav>
      <div className="navigation-bottom"><p>开口，才会越来越自然。</p><button disabled={active} onClick={() => setSettingsOpen(true)}><Settings size={18} />练习偏好</button><small>语音由云端处理<br />练习记录保存在本机</small></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><span>{page === "home" ? "选择一个真实情境" : page === "practice" ? selected?.title_zh : "回看你的每一次进步"}</span><span className={`service-status ${health?.deepseek_configured ? "ready" : ""}`}><i />{health?.deepseek_configured ? health.speech_configured ? "陪练服务已就绪" : "对话已就绪 · 云语音待预配置" : "服务待预配置"}</span></header>
      {error && <div className="page-error" role="alert">{error}<button onClick={() => setError("")}>关闭</button></div>}
      {loading ? <div className="loading-page">正在准备你的练习室…</div> : inviteRequired ? <div className="invite-page"><section><span>朋友专属练习室</span><h1>输入邀请码，开始练习。</h1><p>首次使用输入一次即可。之后会在这台电脑上自动连接，不需要填写 API Key。</p><form onSubmit={event => { event.preventDefault(); void redeemInvite(); }}><label htmlFor="invite-code">邀请码</label><input id="invite-code" value={inviteCode} onChange={event => setInviteCode(event.target.value)} autoComplete="off" spellCheck={false} placeholder="LS-…" maxLength={60} /><button className="primary" disabled={inviteBusy || !inviteCode.trim()}>{inviteBusy ? "正在验证…" : "进入练习室"}</button></form></section></div> : !scenarios.length ? <div className="loading-page"><p>练习室未能连接。</p><button className="primary" onClick={() => void boot()}><RefreshCw size={16} />重新连接</button></div> : <>
      {page === "home" && <div className="home-layout"><section className="scenario-library">
        <div className="page-heading"><div><h1>把英语用在生活里。</h1><p>选一个情境，和 Mia 自然聊一会儿。</p></div><button className="primary" onClick={() => setEditor({ initial: null })}><Plus size={17} />自定义场景</button></div>
        <div className="filters">{["全部", "生活", "旅行", "职场", "社交", "自定义"].map(item => <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
        <div className="scenario-grid">{visible.map(scenario => { const Icon = icons[scenario.id] || Users; return <button className={`scenario-tile ${selected?.id === scenario.id ? "selected" : ""}`} key={scenario.id} onClick={() => { setSelected(scenario); setLevel(scenario.level); }}>
          <div className={`scene-symbol scene-${scenario.category}`}><Icon size={25} /></div><div><span>{scenario.source === "custom" ? "你的场景" : scenario.category}</span><h2>{scenario.title_zh}</h2><p>{scenario.title}</p></div><small>{scenario.level}</small>
        </button>; })}</div>
        {!visible.length && <div className="empty-state"><h2>从你想说的话开始。</h2><p>描述一个情境，Mia 会帮你整理成练习。</p><button onClick={() => setEditor({ initial: null })}>创建第一个场景</button></div>}
        <div className="library-note"><span>每次练习，三个小目标</span><p>提示只是起点。用自己的话表达，比背一句标准答案更有用。</p></div>
      </section>{selected && <section className="scenario-preview"><div className="preview-character"><Avatar2D reducedMotion={preferences.reducedMotion} /><div className="character-label"><strong>{selected.role_name}</strong><span>你的英语陪练</span></div></div>
        <div className="preview-content"><div className="preview-title"><h2>{selected.title_zh}</h2><div><button className="icon-button" aria-label="复制场景" onClick={() => void copyScenario(selected)}><Copy size={16} /></button>{selected.source === "custom" && <><button className="icon-button" aria-label="编辑场景" onClick={() => setEditor({ initial: selected })}><Pencil size={16} /></button><button className="icon-button" aria-label="删除场景" onClick={() => void removeScenario(selected)}><Trash2 size={16} /></button></>}</div></div>
          <p className="preview-opening">“{selected.opening_line}”</p><ul className="preview-objectives">{selected.objectives.map((goal, i) => <li key={i}><span>{i + 1}</span>{goal}</li>)}</ul>
          <label className="level-select">练习难度<select value={level} onChange={e => setLevel(e.target.value)}><option value="A1">A1 · 入门短句</option><option value="A2">A2 · 日常表达</option><option value="B1">B1 · 连贯交流</option><option value="B2">B2 · 深入讨论</option></select></label>
          <button className="primary start-button" onClick={start}><Mic size={18} />开始这个场景</button>
        </div></section>}</div>}
      {page === "practice" && selected && <div className="practice-layout"><section className="practice-stage">
        <SceneBackdrop scenario={selected} />
        <div className="stage-header"><span>{selected.title}</span><span>{level}</span></div><Avatar2D phase={state.phase} reducedMotion={preferences.reducedMotion} completed={completed} />
        <div className="stage-caption"><h1>{selected.role_name}</h1><span>{selected.role_description}</span></div><div className="status-wrap"><StatusPill phase={state.phase} /></div>
        <section className="goal-panel"><div><strong>本次练习目标</strong><span>{completed}/{state.progress.length || 3}</span></div>{(state.progress.length ? state.progress : selected.objectives.map(objective => ({ objective, completed: false, evidence: "", turn_id: "" }))).map((goal, i) => <div className={goal.completed ? "done" : ""} key={i}><span>{goal.completed ? <Check size={13} /> : i + 1}</span><p>{goal.objective}{goal.evidence && <small>“{goal.evidence}”</small>}</p></div>)}{completed === 3 && <p className="goal-complete">目标已完成！可以结束复盘，也可以继续聊。</p>}</section>
      </section><section className="conversation-panel"><header><div><h2>现在，轮到你开口。</h2><p>说完后自然停顿，Mia 会接着聊。</p></div><span className="connection-dot" /></header>
        <Transcript messages={state.messages} translations={preferences.translations} hints={preferences.hints} roleName={selected.role_name} replay={conversation.replay} canReplay={canSend} />
        {state.partial && <div className="partial-transcript" aria-live="polite">正在听：{state.partial}</div>}
        {state.microphoneError && <div className="notice-banner">{state.microphoneError}</div>}{state.error && <div className="error-banner" role="alert">{state.error}{canSend && <button onClick={() => { if (!conversation.retry()) setText(text || ""); }}>重试这一轮</button>}</div>}
        <div className="composer"><input aria-label="英文输入" value={text} onChange={e => setText(e.target.value)} maxLength={4000} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) send(); }} placeholder={canSend ? "也可以输入英文…" : "等 Mia 说完，或点击打断…"} disabled={!canSend} /><button className="primary icon-button" aria-label="发送" disabled={!canSend || !text.trim()} onClick={send}><ArrowUp size={18} /></button></div>
        <footer className="practice-controls">{state.sessionId ? <><button disabled={canSend || finishing} onClick={conversation.interrupt}><Hand size={16} />打断</button><button className="end-button" disabled={finishing} onClick={() => void finish()}><Square size={14} />{finishing ? "正在结束…" : "结束并复盘"}</button></> : <><button onClick={() => void conversation.stop().then(() => setPage("home"))}><ChevronLeft size={16} />返回场景</button><button className="primary" disabled={state.phase === "starting"} onClick={start}><Mic size={16} />重新开始</button></>}</footer>
      </section></div>}
      {page === "history" && <div className="history-layout"><section className="history-list"><div className="page-heading"><div><h1>每一次开口，都算数。</h1><p>回看表达，再练得更自然。</p></div></div>{sessions.length ? sessions.map(item => <article key={item.id} className={`history-item ${detail?.id === item.id ? "selected" : ""}`}><button onClick={() => void showDetail(item.id)}><strong>{item.scenario?.title_zh || scenarios.find(x => x.id === item.scenario_id)?.title_zh || "历史练习"}</strong><span>{new Date(item.started_at).toLocaleString("zh-CN")}</span><small>{item.status === "interrupted" ? "中断的练习" : "已结束"} · {item.progress.filter(x => x.completed).length}/3 个目标</small></button><button className="icon-button" aria-label="删除练习" onClick={() => void removeSession(item.id)}><Trash2 size={16} /></button></article>) : <div className="empty-state"><h2>你的第一段对话，从这里开始。</h2><p>完成一次练习后，在这里回看表达和反馈。</p><button className="primary" onClick={() => setPage("home")}>选择场景</button></div>}</section>
        <section className="review-panel">{detail ? <><header><div><h2>{detail.scenario?.title_zh || "练习详情"}</h2><p>{detail.scenario?.level || "A2"} · {detail.turns.filter(x => x.role === "user").length} 次表达</p></div><button onClick={() => void repeat(detail)} disabled={reviewBusy}><RefreshCw size={16} />再练一次</button></header><div className="review-content">
          <ReviewSpotlight detail={detail} fresh={freshReviewId === detail.id} />
          <section className="review-summary"><h3>为下一次开口做准备</h3>{detail.review ? <><p>{detail.review.summary}</p><h4>说得不错的地方</h4><ul>{detail.review.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul><h4>下次可以这样表达</h4><ul>{detail.review.improvements.map((x, i) => <li key={i}>{x}</li>)}</ul><h4>下一步</h4><p>{detail.review.next_practice}</p></> : <><p>{reviewBusy ? "正在整理你的表达和建议…" : "对话已保存，可以生成练习复盘。"}</p><button disabled={reviewBusy} onClick={() => void generateReview(detail.id)}>{reviewBusy ? "正在生成…" : "生成复盘"}</button></>}</section>
          <h3>对话记录</h3><Transcript messages={detail.turns.map(t => ({ id: t.id, role: t.role, text: t.text, translation: t.translation, correction: t.correction, suggestedPhrase: t.suggested_phrase }))} roleName={detail.scenario?.role_name || "Mia"} translations={preferences.translations} hints={preferences.hints} />
        </div></> : <div className="empty-state"><History size={36} /><h2>选一段对话，看看你怎么说。</h2><p>练习记录和复盘都保存在这台电脑上。</p></div>}</section></div>}
      </>}
    </div><SettingsDialog open={settingsOpen} value={preferences} onChange={updatePreferences} onClose={() => setSettingsOpen(false)} />
    {editor && <ScenarioEditor initial={editor.initial} onClose={() => setEditor(null)} onSaved={saved => { setEditor(null); setSelected(saved); setLevel(saved.level); void loadScenarios().catch(e => setError(e.message)); setFilter("自定义"); }} />}
  </main>;
}
