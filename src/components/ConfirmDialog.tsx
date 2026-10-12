import { useRef } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';

export interface Confirmation {
  title: string;
  message: string;
  confirmLabel: string;
}

/** DOM-only confirmation: Windows native confirm() can strand renderer focus. */
export function ConfirmDialog({ request, onResult }: { request: Confirmation; onResult: (confirmed: boolean) => void }) {
  const dialog = useRef<HTMLElement>(null);
  useDialogFocus(dialog, true, () => onResult(false));
  return <div className="modal-backdrop confirmation-backdrop">
    <section ref={dialog} className="dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message">
      <h2 id="confirmation-title">{request.title}</h2>
      <p id="confirmation-message">{request.message}</p>
      <footer>
        <button type="button" onClick={() => onResult(false)}>取消</button>
        <button type="button" className="primary" onClick={() => onResult(true)}>{request.confirmLabel}</button>
      </footer>
    </section>
  </div>;
}
