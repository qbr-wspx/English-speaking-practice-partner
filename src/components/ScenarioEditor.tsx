import { useRef, useState } from "react";
import { X, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import type { Scenario, ScenarioDraft } from "../types";
import { useDialogFocus } from "../hooks/useDialogFocus";
const blank: ScenarioDraft = { title: "My conversation", title_zh: "我的场景", category: "自定义", level: "A2", role_name: "Mia", role_description: "", learner_role: "", background: "", opening_line: "", opening_translation: "", objectives: ["", "", ""], suggested_phrases: [""] };
export function ScenarioEditor({ initial, onClose, onSaved }: { initial: Scenario | null; onClose: () => void; onSaved: (saved: Scenario) => void }) {
  const [draft, setDraft] = useState<ScenarioDraft>(initial ? { ...initial } : blank);
  const [description, setDescription] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const dialog = useRef<HTMLElement>(null); useDialogFocus(dialog, true, onClose, !busy);
  const update = (key: keyof ScenarioDraft, value: string | string[]) => setDraft(old => ({ ...old, [key]: value }));
  const generate = async () => {
    if (description.trim().length < 3) return setError("请描述一下想练习的情境。");
    setBusy(true); setError("");
    try { setDraft(await api<ScenarioDraft>("/api/scenarios/generate", { method: "POST", body: JSON.stringify({ description, level: draft.level }) })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const save = async () => {
    if ([draft.title, draft.title_zh, draft.role_name, draft.role_description, draft.learner_role, draft.background, draft.opening_line, draft.opening_translation, ...draft.objectives].some(x => !x.trim()) || !draft.suggested_phrases.some(x => x.trim())) return setError("请补齐角色、背景、开场白、三个目标和至少一句表达提示。");
    setBusy(true); setError("");
    try { const saved = await api<Scenario>(initial ? `/api/scenarios/${initial.id}` : "/api/scenarios", { method: initial ? "PUT" : "POST", body: JSON.stringify({ ...draft, suggested_phrases: draft.suggested_phrases.filter(x => x.trim()) }) }); onSaved(saved); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop"><section ref={dialog} className="dialog editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-title">
    <header><div><small>把你需要的对话变成练习</small><h2 id="editor-title">{initial ? "编辑场景" : "创建你的场景"}</h2></div><button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭编辑"><X /></button></header>
    <div className="generate-row"><textarea aria-label="场景描述" placeholder="例如：我是一名产品经理，想练习用英语向客户介绍新功能。" value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} /><button className="primary" disabled={busy} onClick={() => void generate()}><Sparkles size={16} />{busy ? "正在处理…" : "生成场景"}</button></div>
    <div className="form-grid">
      <label>中文名称<input value={draft.title_zh} onChange={e => update("title_zh", e.target.value)} maxLength={100} /></label>
      <label>英文名称<input value={draft.title} onChange={e => update("title", e.target.value)} maxLength={100} /></label>
      <label>难度<select value={draft.level} onChange={e => update("level", e.target.value)}>{["A1", "A2", "B1", "B2"].map(x => <option key={x}>{x}</option>)}</select></label>
      <label>陪练名字<input value={draft.role_name} onChange={e => update("role_name", e.target.value)} maxLength={40} /></label>
      <label>陪练身份<input value={draft.role_description} onChange={e => update("role_description", e.target.value)} maxLength={2000} /></label>
      <label>你的身份<input value={draft.learner_role} onChange={e => update("learner_role", e.target.value)} maxLength={100} /></label>
      <label className="span-two">场景背景<textarea value={draft.background} onChange={e => update("background", e.target.value)} maxLength={2000} /></label>
      <label className="span-two">英文开场白<textarea value={draft.opening_line} onChange={e => update("opening_line", e.target.value)} maxLength={500} /></label>
      <label className="span-two">开场白中文释义<input value={draft.opening_translation} onChange={e => update("opening_translation", e.target.value)} maxLength={500} /></label>
      <label className="span-two">三个练习目标{draft.objectives.map((item, index) => <input key={index} aria-label={`练习目标 ${index + 1}`} value={item} onChange={e => update("objectives", draft.objectives.map((x, i) => i === index ? e.target.value : x))} maxLength={300} />)}</label>
      <label className="span-two">常用表达（每行一句）<textarea value={draft.suggested_phrases.join("\n")} onChange={e => update("suggested_phrases", e.target.value.split("\n").slice(0, 8))} /></label>
    </div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <footer><button onClick={onClose} disabled={busy}>取消</button><button className="primary" disabled={busy} onClick={() => void save()}>保存场景</button></footer>
  </section></div>;
}
