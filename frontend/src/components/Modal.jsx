import { useLayoutEffect, useRef } from 'react';
export function Modal({
  titleId,
  descriptionId,
  onClose,
  children,
  className,
  panelRef,
  closing = false,
}) {
  const ownRef = useRef(null);
  const ref = panelRef || ownRef;
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={[className, closing && 'is-closing'].filter(Boolean).join(' ') || undefined}
      inert={closing || undefined}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
