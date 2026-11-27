// Reading and writing OpenDeck profiles on disk.
//
// Layout (relative to the OpenDeck config dir):
//   profiles/<device>.json                 { "selected_profile": "<profile id>" }
//   profiles/<device>/<profile id>.json    the profile (profile ids may contain "/" for folders)
//   images/<device>/<profile id>/<Controller.position.index>/<n>[-user].<ext>
//
// Inside a profile, a state image beginning with a digit is a file name in that instance's image directory; anything
// else is a path relative to the config dir (or a data URL / built-in "opendeck/..." resource).

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { ActionInstance, Profile, Slot } from "../shared/types.ts";
import { HttpError, paths, safeJoin } from "./config.ts";

const PROFILE_EXT = ".json";

export function profilePath(device: string, profile: string): string {
  return safeJoin(paths.profiles, device, profile + PROFILE_EXT);
}

export function imagesRoot(device: string, profile: string): string {
  return safeJoin(paths.images, device, profile);
}

function hash(contents: string | null): string {
  return contents === null ? "missing" : createHash("sha256").update(contents).digest("hex");
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Device ids that have profiles on disk. */
export async function listDeviceIds(): Promise<string[]> {
  const entries = await fs.readdir(paths.profiles, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/** Profile ids for a device, including ones nested in folders ("Folder/Profile"). */
export async function listProfiles(device: string): Promise<string[]> {
  const root = safeJoin(paths.profiles, device);
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(PROFILE_EXT))
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).slice(0, -PROFILE_EXT.length).split(path.sep).join("/"))
    .sort((a, b) => a.localeCompare(b));
}

export async function getSelectedProfile(device: string): Promise<string | null> {
  const raw = await readIfExists(safeJoin(paths.profiles, device + PROFILE_EXT));
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { selected_profile?: string }).selected_profile ?? null;
  } catch {
    return null;
  }
}

async function setSelectedProfile(device: string, profile: string): Promise<void> {
  const file = safeJoin(paths.profiles, device + PROFILE_EXT);
  const existing = await readIfExists(file);
  const value = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
  value.selected_profile = profile;
  await writeAtomic(file, JSON.stringify(value, null, 2));
}

export async function readProfile(device: string, profile: string): Promise<{ data: Profile; hash: string }> {
  const raw = await readIfExists(profilePath(device, profile));
  if (raw === null) throw new HttpError(404, `Profile ${profile} not found for ${device}`, "not_found");
  const data = JSON.parse(raw) as Profile;
  data.keys ??= [];
  data.sliders ??= [];
  return { data, hash: hash(raw) };
}

export async function currentHash(device: string, profile: string): Promise<string> {
  return hash(await readIfExists(profilePath(device, profile)));
}

/** Same scheme as OpenDeck's Store::save: write a temp file, then rename over the original. */
async function writeAtomic(file: string, contents: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + ".webdeck-temp";
  await fs.writeFile(temp, contents);
  await fs.rename(temp, file);
}

// ---------------------------------------------------------------------------------------------------------------------
// Images

const isInstanceImageFile = (value: string) => /^\d/.test(value);

function decodeDataUrl(value: string): { ext: string; bytes: Buffer } | null {
  const match = /^data:([^/;,]+)\/([^;,]+)((?:;[^,]*)?),(.*)$/s.exec(value);
  if (!match) return null;
  const ext = match[2].split("+")[0];
  const isBase64 = match[3].includes(";base64");
  const bytes = isBase64 ? Buffer.from(match[4], "base64") : Buffer.from(decodeURIComponent(match[4]), "utf8");
  return { ext, bytes };
}

function* walkInstances(slots: Slot[]): Generator<ActionInstance> {
  for (const slot of slots) {
    if (!slot) continue;
    yield slot;
    for (const child of slot.children ?? []) yield child;
  }
}

interface ImagePlan {
  /** Files to write, per instance context directory. */
  writes: Map<string, Map<string, Buffer>>;
  /** Context directories whose old contents must be cleared first (they now hold a different instance). */
  reset: Set<string>;
  /** Context directories that no longer belong to any instance. */
  remove: Set<string>;
}

/**
 * Work out every image file operation needed to save `data`, and rewrite the profile's image fields to the file names
 * OpenDeck expects. All reads of existing files happen here, before anything on disk is modified, so moves and swaps
 * between instances can't clobber their own sources.
 */
async function planImages(root: string, data: Profile): Promise<ImagePlan> {
  const plan: ImagePlan = { writes: new Map(), reset: new Set(), remove: new Set() };
  const liveContexts = new Set<string>();

  const queueWrite = (ctx: string, file: string, bytes: Buffer) => {
    if (!plan.writes.has(ctx)) plan.writes.set(ctx, new Map());
    plan.writes.get(ctx)!.set(file, bytes);
  };

  const slots = [...data.keys, ...data.sliders, ...(data.infobars ?? [])];
  for (const instance of walkInstances(slots)) {
    const target = instance.context;
    // undefined: unchanged since load; null: brand-new instance; otherwise the context it was moved/copied from.
    const origin = instance.__origin === undefined ? target : instance.__origin;
    safeJoin(root, target); // validate
    if (origin) safeJoin(root, origin);
    liveContexts.add(target);
    if (origin !== target) plan.reset.add(target);

    for (const [index, state] of instance.states.entries()) {
      for (const field of ["image", "image_override"] as const) {
        const value = state[field];
        if (typeof value !== "string" || value === "") continue;

        if (value.startsWith("data:")) {
          const decoded = decodeDataUrl(value);
          if (!decoded) continue;
          const file = `${index}${field === "image_override" ? "-user" : ""}.${decoded.ext}`;
          queueWrite(target, file, decoded.bytes);
          state[field] = file;
        } else if (isInstanceImageFile(value) && origin && origin !== target) {
          try {
            queueWrite(target, value, await fs.readFile(safeJoin(root, origin, value)));
          } catch {
            // Source image is gone; OpenDeck falls back to the action's default image.
          }
        }
      }
    }
    delete instance.__origin;
  }

  const existing = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of existing) {
    if (entry.isDirectory() && /^[A-Za-z]+\.\d+\.\d+$/.test(entry.name) && !liveContexts.has(entry.name)) {
      plan.remove.add(entry.name);
    }
  }
  return plan;
}

async function applyImagePlan(root: string, plan: ImagePlan): Promise<void> {
  for (const ctx of [...plan.remove, ...plan.reset]) {
    await fs.rm(safeJoin(root, ctx), { recursive: true, force: true });
  }
  for (const [ctx, files] of plan.writes) {
    const dir = safeJoin(root, ctx);
    await fs.mkdir(dir, { recursive: true });
    for (const [file, bytes] of files) await fs.writeFile(safeJoin(dir, file), bytes);
  }
  // Don't leave an empty images/<device>/<profile> folder behind (fails harmlessly if it has contents).
  await fs.rmdir(root).catch(() => undefined);
}

/**
 * Write a profile and its images. Must only be called while OpenDeck is stopped (see `whileStopped`), otherwise
 * OpenDeck will overwrite the file from its in-memory copy.
 */
export async function writeProfile(device: string, profile: string, data: Profile, activate: boolean): Promise<string> {
  const root = imagesRoot(device, profile);
  const plan = await planImages(root, data);
  await applyImagePlan(root, plan);

  const contents = JSON.stringify(data, null, 2);
  await writeAtomic(profilePath(device, profile), contents);
  if (activate) await setSelectedProfile(device, profile);
  return hash(contents);
}
