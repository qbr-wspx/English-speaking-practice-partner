import { useCallback, useEffect, useRef, useState } from 'react';
import type { Confirmation } from '../components/ConfirmDialog';

export function useConfirmation() {
  const [request, setRequest] = useState<Confirmation | null>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  const confirm = useCallback((next: Confirmation): Promise<boolean> => {
    // Rapid repeat clicks must not replace the pending decision or duplicate work.
    if (pending.current) return Promise.resolve(false);
    return new Promise(resolve => { pending.current = resolve; setRequest(next); });
  }, []);
  const respond = useCallback((confirmed: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }, []);
  useEffect(() => () => { pending.current?.(false); pending.current = null; }, []);
  return { request, confirm, respond };
}
