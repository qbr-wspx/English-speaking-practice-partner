import { useEffect, useRef } from "react";
import { Volume2 } from "lucide-react";
import type { ConversationMessage } from "../store/conversation";
export function Transcript({ messages, translations = true, hints = true, roleName = "Mia", replay, canReplay = false }: { messages: ConversationMessage[]; translations?: boolean; hints?: boolean; roleName?: string; replay?: (id: string) => void; canReplay?: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [messages]);
  return <div className="transcript-list" ref={list}>
    {!messages.length && <div className="empty-transcript"><strong>先听一句，再接着说。</strong><p>开始练习后，{roleName} 会先开口。想不到完整句子时，也可以先说关键词。</p></div>}
    {messages.map(message => <article key={message.id} className={`message-row ${message.role}`}>
      <div className="message-meta">{message.role === "assistant" ? roleName : "你"}{message.role === "assistant" && replay && <button className="icon-button" aria-label="重听回复" disabled={!canReplay} onClick={() => replay(message.id)}><Volume2 size={14} /></button>}</div>
      <div className="message-bubble"><p>{message.text}</p>{translations && message.translation && <span className="translation">{message.translation}</span>}</div>
      {hints && message.correction && <div className="coach-note">表达建议：{message.correction}</div>}
      {hints && message.suggestedPhrase && <div className="suggestion"><span>接下来可以说</span><p>{message.suggestedPhrase}</p></div>}
    </article>)}
  </div>;
}
