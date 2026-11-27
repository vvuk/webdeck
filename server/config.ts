import os from "node:os";
import path from "node:path";

/** Port the webdeck API server listens on (the Vite dev server proxies to it). */
export const PORT = Number(process.env.WEBDECK_PORT ?? 5174);

/** Hostname to bind. Defaults to loopback: this server can rewrite your OpenDeck config, so don't expose it. */
export const HOST = process.env.WEBDECK_HOST ?? "127.0.0.1";

/** OpenDeck's app config directory (Tauri `app_config_dir` for identifier "opendeck"). */
export function defaultConfigDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "opendeck");
    case "win32":
      return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "opendeck");
    default: {
      const flatpak = path.join(home, ".var", "app", "me.amankhanna.opendeck", "config", "opendeck");
      const xdg = path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "opendeck");
      return process.env.OPENDECK_FLATPAK ? flatpak : xdg;
    }
  }
}

export const CONFIG_DIR = path.resolve(process.env.OPENDECK_CONFIG_DIR ?? defaultConfigDir());

export const paths = {
  profiles: path.join(CONFIG_DIR, "profiles"),
  images: path.join(CONFIG_DIR, "images"),
  plugins: path.join(CONFIG_DIR, "plugins"),
};

/** Folder name of the helper plugin inside OpenDeck's plugins directory. */
export const BRIDGE_PLUGIN_ID = "dev.webdeck.bridge.sdPlugin";

/**
 * Join `segments` onto `base`, refusing anything that escapes `base` (e.g. "..", absolute paths).
 * Every user-supplied path component (device ids, profile ids, file paths) must go through this.
 */
export function safeJoin(base: string, ...segments: string[]): string {
  const resolved = path.resolve(base, ...segments);
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new HttpError(400, `Path escapes ${base}`);
  }
  return resolved;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: "conflict" | "not_found" | "bad_request" | "internal",
  ) {
    super(message);
  }
}
