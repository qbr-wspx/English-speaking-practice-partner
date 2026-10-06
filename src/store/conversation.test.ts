import { beforeEach, describe, expect, it } from "vitest";
import { useConversationStore } from "./conversation";

describe("conversation store", () => {
  beforeEach(() => useConversationStore.getState().reset());

  it("moves through a complete spoken turn", () => {
    const state = useConversationStore.getState();
    state.setPhase("listening");
    expect(useConversationStore.getState().phase).toBe("listening");
    state.setPhase("transcribing");
    state.setPhase("thinking");
    state.setPhase("speaking");
    expect(useConversationStore.getState().phase).toBe("speaking");
    state.setPhase("listening");
    expect(useConversationStore.getState().phase).toBe("listening");
  });

  it("keeps messages while a turn progresses", () => {
    useConversationStore.getState().addMessage({ role: "user", text: "A latte, please." });
    useConversationStore.getState().addMessage({ role: "assistant", text: "What size?" });
    expect(useConversationStore.getState().messages).toHaveLength(2);
  });
});

