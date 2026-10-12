import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Preferences } from "../types";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { AvatarDistanceControl } from "./AvatarDistanceControl";
export function SettingsDialog({ open, value, onChange, onClose }: { open: boolean; value: Preferences; onChange: (value: Preferences) => void; onClose: () => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const dialog = useRef<HTMLElement>(null); useDialogFocus(dialog, open, onClose);
  useEffect(() => { if (open) void navigator.mediaDevices?.enumerateDevices().then(items => setDevices(items.filter(x => x.kind === "audioinput"))).catch(() => undefined); }, [open]);
  if (!open) return null;
  const update = (patch: Partial<Preferences>) => onChange({ ...value, ...patch });
  return <div className="modal-backdrop"><section ref={dialog} className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <header><div><small>让练习适合你</small><h2 id="settings-title">练习偏好</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭设置"><X /></button></header>
    <label>陪练音色<select value={value.voice} onChange={e => update({ voice: e.target.value })}><option value="loongcally_v3">Mia · Cally（美式）</option><option value="loongabby_v3">Mia · Abby（美式）</option><option value="loongannie_v3">Mia · Annie（美式）</option><option value="loongemily_v3">Mia · Emily（英式）</option></select></label>
    <label>语速 <span>{value.rate.toFixed(2)}×</span><input type="range" min="0.7" max="1.3" step="0.05" value={value.rate} onChange={e => update({ rate: Number(e.target.value) })} /></label>
    <AvatarDistanceControl value={value.avatarScale} onChange={avatarScale => update({ avatarScale })} />
    <label>麦克风<select value={value.microphone} onChange={e => update({ microphone: e.target.value })}><option value="">系统默认麦克风</option>{devices.filter(d => d.deviceId).map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `麦克风 ${i + 1}`}</option>)}</select></label>
    <label className="check-label"><input type="checkbox" checked={value.translations} onChange={e => update({ translations: e.target.checked })} />显示中文翻译</label>
    <label className="check-label"><input type="checkbox" checked={value.hints} onChange={e => update({ hints: e.target.checked })} />显示表达提示与纠错</label>
    <label className="check-label"><input type="checkbox" checked={value.reducedMotion} onChange={e => update({ reducedMotion: e.target.checked })} />减少人物动作（关闭自动眨眼与呼吸）</label>
    <p className="muted">音色、语速和麦克风在下一次练习生效。人物距离、字幕和提示即时生效。</p>
    <details className="muted"><summary>角色素材</summary><p>使用已确认的 A 哑光版左侧半身原画，仅叠加闭眼和张嘴局部素材。支持自然眨眼、轻微呼吸与音频驱动的两态口型；停止或打断立即闭嘴。这是 2D 表情切换，不是 Live2D。</p></details>
    <footer><button className="primary" onClick={onClose}>完成</button></footer>
  </section></div>;
}
