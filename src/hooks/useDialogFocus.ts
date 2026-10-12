import { useEffect, useRef, type RefObject } from "react";

/** Keep keyboard focus in a modal and restore its trigger after closing. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void, canClose = true) {
  const closeRef = useRef(close); closeRef.current = close;
  const allowedRef = useRef(canClose); allowedRef.current = canClose;
  useEffect(() => {
    if (!open || !ref.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    const elements = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
    elements()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && allowedRef.current) { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = elements(); const first = items[0], last = items.at(-1);
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open, ref]);
}
