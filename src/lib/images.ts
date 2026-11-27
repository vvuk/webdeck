import type { ActionInstance } from "../../shared/types.ts";

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/**
 * Turn an image reference from a profile into a URL the browser can load, following OpenDeck's rules
 * (see `reconstruct_image` in simplified_profile.rs). `revision` busts the cache after saves rewrite files in place.
 */
export function imageUrl(
  value: string | null | undefined,
  instance: ActionInstance,
  device: string,
  profile: string,
  revision: number,
): string | null {
  if (!value) return null;
  if (value.startsWith("data:")) return value;
  if (value.startsWith("opendeck/")) return null; // built into the OpenDeck binary; not reachable
  if (/^\d/.test(value)) {
    // Numbered files live in the directory of the slot the instance was loaded from.
    const dir = instance.__origin || instance.context;
    return `/files/images/${encodeURIComponent(device)}/${encodePath(profile)}/${dir}/${encodeURIComponent(value)}?v=${revision}`;
  }
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return null; // absolute path outside the config dir
  return `/files/${encodePath(value)}?v=${revision}`;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const KEY_PX = 288; // what OpenDeck's own editor resizes to

/** Fit an image into a square PNG (letterboxed, like OpenDeck). Animated GIFs and SVGs are kept as-is. */
async function normalise(blob: Blob): Promise<string> {
  const dataUrl = await readAsDataUrl(blob);
  if (blob.type === "image/gif" || blob.type === "image/svg+xml") return dataUrl;

  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = KEY_PX;
  const ctx = canvas.getContext("2d")!;
  const scale = KEY_PX / Math.max(img.naturalWidth, img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (KEY_PX - w) / 2, (KEY_PX - h) / 2, w, h);
  return canvas.toDataURL("image/png");
}

export const imageFromFile = (file: Blob) => normalise(file);

/** Does this drag carry something we could turn into an image? (Only types are readable before the drop.) */
export const dragHasImage = (dt: DataTransfer) =>
  dt.types.includes("Files") || dt.types.includes("text/uri-list") || dt.types.includes("text/html");

/**
 * Extract an image from a drop: a file from Finder/Explorer, or an image dragged out of another web page (which
 * usually arrives as a URL, so we download it through the server to get around CORS).
 * Must be called synchronously inside the drop handler; DataTransfer contents vanish after it returns.
 */
export function imageFromDrop(dt: DataTransfer): Promise<string> | null {
  const file = [...dt.files].find((f) => f.type.startsWith("image/"));
  if (file) return normalise(file);

  const html = dt.getData("text/html");
  const fromHtml = /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1]?.replace(/&amp;/g, "&");
  const uri = dt.getData("text/uri-list").split("\n").find((l) => l && !l.startsWith("#"));
  const url = fromHtml || uri?.trim();
  if (!url) return null;

  return (async () => {
    if (url.startsWith("data:image/")) return normalise(await (await fetch(url)).blob());
    const response = await fetch(`/api/remote-image?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Couldn't download image (${response.status})`);
    }
    return normalise(await response.blob());
  })();
}
