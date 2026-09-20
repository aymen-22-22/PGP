/** Longest edge of a stored product photo, in pixels. */
const MAX_EDGE = 800;

/**
 * Shrinks a chosen picture before it is uploaded.
 *
 * A phone camera produces four or five megabytes. Sending that from a warehouse
 * on mobile data is slow enough that people stop adding pictures, and the
 * catalogue only ever shows the image a couple of hundred pixels wide. Doing it
 * here rather than on the server also keeps the API free of an image library,
 * which matters on shared hosting.
 *
 * Returns the original file untouched if anything goes wrong — a picture that
 * uploads slowly beats one that does not upload at all.
 */
export async function shrinkImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

    // Already small enough, and re-encoding would only lose quality.
    if (scale === 1 && file.size < 400_000) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      // JPEG rather than the original format: a photographed handset is a
      // photograph, and PNG would store it several times larger.
      canvas.toBlob(resolve, 'image/jpeg', 0.82),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}
