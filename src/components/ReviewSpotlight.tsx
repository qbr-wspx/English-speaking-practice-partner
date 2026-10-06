import { ArrowRight, Check, Sparkles } from "lucide-react";
import type { SessionDetail } from "../types";

export function ReviewSpotlight({ detail, fresh }: { detail: SessionDetail; fresh: boolean }) {
  const completed = detail.progress.filter(goal => goal.completed);
  const userTurns = detail.turns.filter(turn => turn.role === "user");
  const improvement = detail.review?.spotlight;
  const summaryLead = detail.review?.summary.match(/^.*?[。！？]/)?.[0] || detail.review?.summary;
  return <div className={`review-showcase ${fresh ? "review-showcase--fresh" : ""}`}>
    <div className="review-hero">
      <span className="review-eyebrow"><Sparkles size={15} /> PRACTICE COMPLETE · 练习完成</span>
      <h3>{userTurns.length ? <>你已经把英语<br /><em>说出来了。</em></> : <>这次练习已记录。<br /><em>下次，等你开口。</em></>}</h3>
      <p>{summaryLead || "这一段真实对话已经保存。复盘生成后，你会在这里看到自己的进步。"}</p>
      <div className="review-hero-stats">
        <div><strong>{completed.length}<small> / {detail.progress.length || 3}</small></strong><span>有表达依据的目标</span></div>
        <div><strong>{userTurns.length}</strong><span>次主动表达</span></div>
      </div>
    </div>
    <section className="review-evidence">
      <div className="review-section-heading"><span>01 / GOALS</span><h4>目标，是这样完成的</h4></div>
      <div className="review-evidence-grid">{detail.progress.map((goal, index) => <article className={goal.completed ? "achieved" : ""} key={index}>
        <div className="review-goal-mark">{goal.completed ? <Check size={18} /> : String(index + 1).padStart(2, "0")}</div>
        <div><strong>{goal.objective}</strong><span>{goal.completed ? "已在对话中做到" : "下次继续练习"}</span>{goal.evidence && <blockquote>“{goal.evidence}”</blockquote>}</div>
      </article>)}</div>
    </section>
    {improvement && <section className="review-before-after">
      <div className="review-section-heading"><span>02 / EXPRESSION</span><h4>一句话，更自然一点</h4></div>
      <div className="review-phrase-row"><div><small>你说过</small><p>{improvement.original}</p></div><ArrowRight size={18} /><div><small>可以试试</small><p>{improvement.improved}</p></div></div>
      <p className="review-phrase-note">{improvement.explanation}</p>
    </section>}
  </div>;
}
