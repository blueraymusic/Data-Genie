export async function prepareProfilePhoto(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('Choose a PNG, JPEG or WebP photo.');
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('Choose a photo under 5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('This photo could not be opened. Try another image.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    const context = canvas.getContext('2d');
    if (!context || !image.naturalWidth || !image.naturalHeight)
      throw new Error('This photo could not be opened. Try another image.');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.fillStyle = '#eff2f7';
    context.fillRect(0, 0, 192, 192);
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      192,
      192,
    );
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
