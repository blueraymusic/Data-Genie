import { useEffect, useId, useRef } from 'react';
import { Icon } from './Icon';
import { useDismissMotion } from '../hooks/useMotion';

function available(node) {
  if (
    node.disabled ||
    node.tabIndex < 0 ||
    node.type === 'hidden' ||
    node.closest('[hidden], [inert]')
  )
    return false;
  const closed = node.closest('details:not([open])');
  return (
    (!closed || node === closed.querySelector(':scope > summary')) &&
    getComputedStyle(node).display !== 'none'
  );
}

export function WorkspaceDialog({ title, description, busy, onClose, children, wide = false }) {
  const titleId = useId(),
    descriptionId = useId(),
    panel = useRef(null);
  const { dismiss, closing } = useDismissMotion(panel, onClose);
  useEffect(() => {
    const previous = document.activeElement;
    const first =
      [...(panel.current?.querySelectorAll('input, select, textarea') || [])].find(available) ||
      [...(panel.current?.querySelectorAll('button') || [])].find(available);
    (first || panel.current)?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className={'workspace-dialog-backdrop' + (closing ? ' is-closing' : '')}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) dismiss();
      }}
    >
      <section
        ref={panel}
        inert={closing || undefined}
        className={'workspace-dialog' + (wide ? ' workspace-dialog-wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation();
            dismiss();
          }
          if (event.key !== 'Tab') return;
          const focusable = [
            ...panel.current.querySelectorAll(
              'button, input, select, textarea, a[href], summary, [tabindex]',
            ),
          ].filter(available);
          const first = focusable[0],
            last = focusable.at(-1);
          if (!first) {
            event.preventDefault();
            panel.current.focus();
          } else if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === panel.current)
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="workspace-dialog-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && (
              <p id={descriptionId} className="muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn quiet workspace-close"
            aria-label="Close dialog"
            disabled={busy}
            onClick={dismiss}
          >
            <Icon name="x" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
