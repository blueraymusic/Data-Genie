import { useEffect, useState } from 'react';

export function useFileDrop({ disabled, onFiles }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (disabled) setActive(false);
  }, [disabled]);
  return {
    active,
    handlers: {
      onDragOver(event) {
        if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
        if (!disabled) setActive(true);
      },
      onDragLeave(event) {
        if (!event.currentTarget.contains(event.relatedTarget)) setActive(false);
      },
      onDrop(event) {
        if (!event.dataTransfer.files?.length) return;
        event.preventDefault();
        setActive(false);
        if (!disabled) onFiles(Array.from(event.dataTransfer.files));
      },
    },
  };
}
