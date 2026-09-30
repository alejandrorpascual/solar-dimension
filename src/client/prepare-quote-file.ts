import { QUOTE_LIMITS } from '../lib/quote-limits'

const MAX_EDGE_PX = 2048
const JPEG_QUALITY = 0.85
/** Photos under this size and edge go up as they are. */
const SMALL_BYTES = QUOTE_LIMITS.maxBytes / 4

/**
 * Phone photos are often larger than the upload limit. Shrinking them in the browser keeps them under it, and costs
 * fewer model tokens. PDFs pass through. If the browser can't decode the image, the file is sent as is, and the
 * server's checks decide.
 */
export async function prepareQuoteFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size <= SMALL_BYTES) {
      bitmap.close()
      return file
    }
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' })
  } catch (error) {
    console.error('[quotes] shrinking a photo failed; uploading it as is', { name: file.name, error })
    return file
  }
}
