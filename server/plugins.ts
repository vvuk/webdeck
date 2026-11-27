// Reading installed plugins' manifests and turning their actions into the shape OpenDeck stores in profiles.
// Mirrors `initialise_plugin` in OpenDeck's src-tauri/src/plugins/mod.rs.

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { Action, ActionCategory, ActionState } from "../shared/types.ts";
import { BRIDGE_PLUGIN_ID, CONFIG_DIR, paths } from "./config.ts";

type Json = Record<string, unknown>;

const FONT_SUBSTITUTES: Record<string, string> = {
  arial: "Liberation Sans",
  "arial black": "Archivo Black",
  "comic sans ms": "Comic Neue",
  courier: "Courier Prime",
  "courier new": "Courier Prime",
  georgia: "Tinos",
  impact: "Anton",
  "microsoft sans serif": "Liberation Serif",
  "times new roman": "Liberation Serif",
  tahoma: "Open Sans",
  verdana: "Open Sans",
  "trebuchet ms": "Fira Sans",
};

export const DEFAULT_STATE: ActionState = {
  image: "actionDefaultImage",
  image_override: null,
  image_scale: 100,
  background_colour: "#000000",
  name: "",
  text: "",
  text_override: null,
  show: true,
  colour: "#FFFFFF",
  stroke_colour: "#000000",
  alignment: "middle",
  family: "Liberation Sans",
  style: "Regular",
  size: 16,
  stroke_size: 3,
  underline: false,
};

/** Config-dir-relative path with forward slashes, as OpenDeck writes them to disk. */
const toConfigRelative = (absolute: string) => path.relative(CONFIG_DIR, absolute).split(path.sep).join("/");

/** OpenDeck's `convert_icon`: manifest icon paths have no extension. */
function resolveIcon(pluginDir: string, icon: string): string {
  const base = path.join(pluginDir, icon);
  const candidates = [base + ".svg", base + "@2x.png", base + ".png", base];
  return toConfigRelative(candidates.find((c) => existsSync(c)) ?? base + ".png");
}

const pick = <T>(obj: Json, ...keys: string[]): T | undefined => {
  for (const key of keys) if (obj[key] !== undefined) return obj[key] as T;
  return undefined;
};

function convertState(raw: Json, pluginDir: string, actionIcon: string): ActionState {
  const image = pick<string>(raw, "Image", "image");
  const family = pick<string>(raw, "FontFamily", "family") ?? DEFAULT_STATE.family;
  const size = Number(pick(raw, "FontSize", "size") ?? DEFAULT_STATE.size);
  return {
    ...DEFAULT_STATE,
    image: !image || image === "actionDefaultImage" ? actionIcon : resolveIcon(pluginDir, image),
    name: pick(raw, "Name", "name") ?? "",
    text: pick(raw, "Title", "text") ?? "",
    show: pick(raw, "ShowTitle", "show") ?? true,
    colour: pick(raw, "TitleColor", "colour") ?? DEFAULT_STATE.colour,
    alignment: pick(raw, "TitleAlignment", "alignment") ?? "middle",
    family: FONT_SUBSTITUTES[family.toLowerCase().trim()] ?? family,
    style: pick(raw, "FontStyle", "style") ?? "Regular",
    size: Number.isFinite(size) ? size : DEFAULT_STATE.size,
    underline: pick(raw, "FontUnderline", "underline") ?? false,
  };
}

function convertAction(raw: Json, pluginId: string, pluginDir: string, manifestPi: string | undefined): Action {
  const icon = resolveIcon(pluginDir, pick<string>(raw, "Icon", "icon") ?? "");
  const pi = pick<string>(raw, "PropertyInspectorPath", "property_inspector") || manifestPi;
  const rawStates = pick<Json[]>(raw, "States", "states") ?? [];
  const states = (rawStates.length ? rawStates : [{}]).map((s) => convertState(s, pluginDir, icon));
  return {
    name: pick(raw, "Name", "name") ?? "",
    uuid: pick(raw, "UUID", "uuid") ?? "",
    plugin: pluginId,
    tooltip: pick(raw, "Tooltip", "tooltip") ?? "",
    icon,
    disable_automatic_states: pick(raw, "DisableAutomaticStates") ?? false,
    visible_in_action_list: pick(raw, "VisibleInActionsList") ?? true,
    supported_in_multi_actions: pick(raw, "SupportedInMultiActions") ?? true,
    property_inspector: pi ? toConfigRelative(path.join(pluginDir, pi)) : "",
    controllers: pick(raw, "Controllers", "controllers") ?? ["Keypad"],
    // OpenDeck fills encoder details from the manifest when it loads a profile, so leaving this null is safe.
    encoder: null,
    states,
  };
}

/** RFC 7386 JSON merge patch, used for OpenDeck's manifest.<os>.json overrides. */
function mergePatch(target: unknown, patch: unknown): unknown {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return patch;
  const result: Json = typeof target === "object" && target !== null && !Array.isArray(target) ? { ...(target as Json) } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result;
}

const OS_NAME: Record<string, string> = { darwin: "macos", win32: "windows", linux: "linux" };

async function readManifest(pluginDir: string): Promise<Json> {
  const parse = (text: string) => JSON.parse(text.replace(/^﻿/, "")) as Json;
  let manifest = parse(await fs.readFile(path.join(pluginDir, "manifest.json"), "utf8"));
  const override = path.join(pluginDir, `manifest.${OS_NAME[process.platform] ?? process.platform}.json`);
  if (existsSync(override)) {
    try {
      manifest = mergePatch(manifest, parse(await fs.readFile(override, "utf8"))) as Json;
    } catch {
      // Ignore broken overrides, like OpenDeck does.
    }
  }
  return manifest;
}

export async function listActionCategories(): Promise<ActionCategory[]> {
  const entries = await fs.readdir(paths.plugins, { withFileTypes: true }).catch(() => []);
  const categories = new Map<string, ActionCategory>();

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(".sdPlugin") || entry.name === BRIDGE_PLUGIN_ID) continue;
    const pluginDir = path.join(paths.plugins, entry.name);
    let manifest: Json;
    try {
      manifest = await readManifest(pluginDir);
    } catch {
      continue;
    }
    const actions = (pick<Json[]>(manifest, "Actions") ?? [])
      .map((a) => convertAction(a, entry.name, pluginDir, pick(manifest, "PropertyInspectorPath")))
      .filter((a) => a.visible_in_action_list && a.uuid);
    if (!actions.length) continue;

    const name = pick<string>(manifest, "Category") ?? pick<string>(manifest, "Name") ?? entry.name;
    const category = categories.get(name) ?? { name, plugin: entry.name, actions: [] };
    category.actions.push(...actions);
    categories.set(name, category);
  }
  return [...categories.values()].sort((a, b) => a.name.localeCompare(b.name));
}
