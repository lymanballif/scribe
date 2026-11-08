/**
 * Client-side photo pipeline.
 *
 * Phones hand us 4–12 MB HEIC/JPEGs. We decode, fix orientation, cap the long
 * edge, and re-encode (WebP where the browser can, JPEG otherwise) so a photo
 * lands in the document at ~150–400 KB. That keeps autosave fast, IndexedDB
 * small, and share uploads quick.
 */

export interface PreparedImage {
  src: string;
  width: number;
  height: number;
}

const MAX_EDGE = 2000;
const QUALITY = 0.84;

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  // iOS sometimes reports an empty type for HEIC; sniff the extension.
  return /\.(heic|heif|jpe?g|png|webp|gif|avif|bmp|tiff?)$/i.test(file.name);
}

let webpSupport: Promise<boolean> | null = null;
function canEncodeWebp(): Promise<boolean> {
  if (!webpSupport) {
    webpSupport = new Promise((resolve) => {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      c.toBlob((b) => resolve(b?.type === "image/webp"), "image/webp");
    });
  }
  return webpSupport;
}

function readAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = url;
  });
}

export function imageDimensions(src: string): Promise<{ width: number; height: number }> {
  return loadImage(src).then((img) => ({ width: img.naturalWidth, height: img.naturalHeight }));
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), type, quality);
  });
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      return await loadImage(url);
    } finally {
      // The image element keeps its decoded pixels; the blob URL can go.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
}

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  // Sample a coarse grid; good enough to decide PNG vs JPEG.
  const step = Math.max(1, Math.floor(Math.max(w, h) / 64));
  for (let y = 0; y < h; y += step) {
    const row = ctx.getImageData(0, y, w, 1).data;
    for (let x = 3; x < row.length; x += 4 * step) if (row[x] < 250) return true;
  }
  return false;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  // Animated GIFs would lose their animation through canvas; keep them as-is.
  if (file.type === "image/gif") {
    const src = await readAsDataURL(file);
    return { src, ...(await imageDimensions(src)) };
  }

  const source = await decode(file);
  const sw = "naturalWidth" in source ? source.naturalWidth : source.width;
  const sh = "naturalHeight" in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, width, height);
  if ("close" in source) source.close();

  const alpha = (file.type === "image/png" || file.type === "image/webp") && hasTransparency(ctx, width, height);
  let blob: Blob;
  if (await canEncodeWebp()) {
    blob = await toBlob(canvas, "image/webp", QUALITY);
  } else if (alpha) {
    blob = await toBlob(canvas, "image/png");
  } else {
    if (!alpha) {
      // JPEG has no alpha channel: flatten onto white rather than black.
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
    }
    blob = await toBlob(canvas, "image/jpeg", QUALITY);
  }

  // Tiny PNGs (icons, screenshots of text) can grow when re-encoded; keep the original then.
  const keepOriginal = scale === 1 && blob.size >= file.size && /^image\/(png|jpeg|webp)$/.test(file.type);
  const src = await readAsDataURL(keepOriginal ? file : blob);
  return { src, width, height };
}

export interface PrepareProgress {
  done: number;
  total: number;
}

/** Prepare several photos in parallel while preserving the order the user picked them in. */
export async function prepareImages(
  files: File[],
  onProgress?: (p: PrepareProgress) => void
): Promise<PreparedImage[]> {
  const images = files.filter(isImageFile);
  let done = 0;
  onProgress?.({ done, total: images.length });
  const results = await Promise.all(
    images.map(async (f) => {
      try {
        return await prepareImage(f);
      } catch {
        return null;
      } finally {
        done += 1;
        onProgress?.({ done, total: images.length });
      }
    })
  );
  return results.filter((r): r is PreparedImage => r !== null);
}

/* ——— Helpers for moving images to the server when sharing ——— */

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mime = m[1];
  if (m[2]) {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), mime };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
