export interface Scenario {
  id: string; title: string; title_zh: string; level: string; source: "builtin" | "custom";
  category: string; role_name: string; role_description: string; learner_role: string;
  background: string; opening_line: string; opening_translation: string;
  objectives: string[]; suggested_phrases: string[];
}
export type ScenarioDraft = Omit<Scenario, "id" | "source">;
export interface Goal { objective: string; completed: boolean; evidence: string; turn_id: string }
export interface Review { summary: string; strengths: string[]; improvements: string[]; next_practice: string; spotlight?: { original: string; improved: string; explanation: string } | null }
export interface SessionSummary { id: string; scenario_id: string; started_at: string; ended_at: string | null; status: string; scenario: Scenario | null; progress: Goal[] }
export interface SessionDetail extends SessionSummary { review: Review | null; turns: { id: string; role: "user" | "assistant"; text: string; translation: string; correction: string; suggested_phrase: string }[] }
export interface Preferences { voice: string; rate: number; translations: boolean; hints: boolean; quality: "standard" | "low"; reducedMotion: boolean; microphone: string; avatarScale: number }
export const defaultPreferences: Preferences = { voice: "loongcally_v3", rate: 0.95, translations: true, hints: true, quality: "standard", reducedMotion: false, microphone: "", avatarScale: 1 };
