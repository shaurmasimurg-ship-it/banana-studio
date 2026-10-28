async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch { /* Safari can decode some phone formats through an image element instead. */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Bu fotoğraf biçimi açılamadı. JPEG, PNG veya WebP olarak yeniden seç.'));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export async function prepareImage(file: File, maxBytes: number): Promise<Blob> {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name)) throw new Error('Lütfen bir fotoğraf seç. JPEG, PNG ve WebP desteklenir.');
  if (file.size > 40 * 1024 * 1024) throw new Error('Bu fotoğraf çok büyük. 40 MB altında bir dosya seç.');
  const image = await decodeImage(file);
  try {
    if (!image.width || !image.height) throw new Error('Fotoğrafın boyutları okunamadı. Başka bir fotoğraf seç.');
    let scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Bu tarayıcı fotoğrafı hazırlayamıyor. Safari veya Chrome ile yeniden dene.');
    for (let pass = 0; pass < 3; pass++) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.78, 0.62]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= maxBytes) return blob;
      }
      scale *= 0.75;
    }
    throw new Error('Fotoğraf yükleme sınırına küçültülemedi. Daha küçük bir fotoğraf seç.');
  } finally { image.release(); }
}
