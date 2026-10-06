import { create } from "zustand";
import type { Goal } from "../types";

export type ConversationPhase =
  | "idle"
  | "starting"
  | "listening"
  | "text-ready"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  translation?: string;
  correction?: string;
  suggestedPhrase?: string;
}

interface ConversationState {
  phase: ConversationPhase;
  sessionId: string | null;
  messages: ConversationMessage[];
  error: string | null;
  microphoneError: string | null;
  mouthLevel: number;
  partial: string;
  progress: Goal[];
  setPartial: (partial: string) => void;
  setProgress: (progress: Goal[]) => void;
  setPhase: (phase: ConversationPhase) => void;
  setSessionId: (sessionId: string | null) => void;
  addMessage: (message: Omit<ConversationMessage, "id"> & { id?: string }) => void;
  setError: (error: string | null) => void;
  setMicrophoneError: (error: string | null) => void;
  setMouthLevel: (level: number) => void;
  reset: () => void;
}

const messageId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const useConversationStore = create<ConversationState>((set) => ({
  phase: "idle",
  sessionId: null,
  messages: [],
  error: null,
  microphoneError: null,
  mouthLevel: 0,
  partial: "",
  progress: [],
  setPartial: (partial) => set({ partial }),
  setProgress: (progress) => set({ progress }),
  setPhase: (phase) => set({ phase }),
  setSessionId: (sessionId) => set({ sessionId }),
  addMessage: (message) => set((state) => ({ messages: message.id && state.messages.some(m => m.id === message.id) ? state.messages : [...state.messages, { ...message, id: message.id || messageId() }] })),
  setError: (error) => set((state) => ({ error, phase: error ? "error" : state.phase })),
  setMicrophoneError: (microphoneError) => set({ microphoneError }),
  setMouthLevel: (mouthLevel) => set({ mouthLevel }),
  reset: () => set({ phase: "idle", sessionId: null, messages: [], error: null, microphoneError: null, mouthLevel: 0, partial: "", progress: [] }),
}));
