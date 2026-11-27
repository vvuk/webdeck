import { HttpError } from "./config.ts";

const MAX_BYTES = 15 * 1024 * 1024;

/** Fetch an image by URL on the browser's behalf (cross-origin images can't be read client-side). */
export async function fetchRemoteImage(url: string): Promise<{ contentType: string; bytes: Buffer }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, "Invalid URL", "bad_request");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new HttpError(400, "Only http(s) URLs", "bad_request");

  const response = await fetch(parsed, { signal: AbortSignal.timeout(15000), redirect: "follow" });
  if (!response.ok) throw new HttpError(502, `Image download failed (${response.status})`);
  const contentType = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!contentType.startsWith("image/")) throw new HttpError(415, `Not an image (${contentType || "unknown type"})`, "bad_request");

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new HttpError(413, "Image too large");
  return { contentType, bytes };
}
