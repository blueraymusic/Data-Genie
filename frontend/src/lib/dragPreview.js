// Only a small file emoji follows the pointer; no source-card screenshot or text.
export function setDragPreview(event) {
  if (typeof event.dataTransfer?.setDragImage !== 'function') return;
  const canvas = document.createElement('canvas');
  canvas.width = 40;
  canvas.height = 44;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.font = '32px system-ui';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('📄', 20, 22);
  event.dataTransfer.setDragImage(canvas, 20, 22);
}
