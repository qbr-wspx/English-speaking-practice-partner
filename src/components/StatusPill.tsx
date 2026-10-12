import { AudioLines, CircleAlert, Coffee, Ear, LoaderCircle, MessageCircleMore, Pause } from "lucide-react";
import type { ConversationPhase } from "../store/conversation";

const labels: Record<ConversationPhase, { zh: string; en: string }> = {
  idle: { zh: "准备好了", en: "Ready when you are" },
  starting: { zh: "正在准备", en: "Warming up" },
  listening: { zh: "正在倾听", en: "I'm listening" },
  "text-ready": { zh: "可以输入文字", en: "Type your reply" },
  transcribing: { zh: "正在识别", en: "Catching that" },
  thinking: { zh: "正在思考", en: "Thinking" },
  speaking: { zh: "Mia 正在说", en: "Mia is speaking" },
  paused: { zh: "练习已暂停", en: "Take your time" },
  error: { zh: "需要处理", en: "Something went wrong" },
};

export function StatusPill({ phase }: { phase: ConversationPhase }) {
  const icons = { idle: Coffee, starting: LoaderCircle, listening: Ear, "text-ready": MessageCircleMore, transcribing: AudioLines, thinking: MessageCircleMore, speaking: AudioLines, paused: Pause, error: CircleAlert };
  const Icon = icons[phase];
  return (
    <div className={`status-pill status-${phase}`}>
      <span className="status-icon"><Icon size={18} /></span>
      <span><strong>{labels[phase].zh}</strong><small>{labels[phase].en}</small></span>
      {(phase === "listening" || phase === "speaking") && <span className="sound-bars" aria-hidden="true"><i /><i /><i /><i /></span>}
    </div>
  );
}
