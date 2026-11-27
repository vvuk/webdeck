// The webdeck bridge is a tiny OpenAction plugin (see /bridge) that OpenDeck launches. It is the only way to learn which
// decks are connected and their row/column layout, since that isn't stored in the profile files.

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BRIDGE_PLUGIN_ID, paths } from "./config.ts";

const SOURCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bridge", BRIDGE_PLUGIN_ID);
const INSTALL_DIR = path.join(paths.plugins, BRIDGE_PLUGIN_ID);

export interface BridgeDevice {
  id: string;
  name: string;
  rows: number | null;
  columns: number | null;
  type: number | null;
  connected: boolean;
}

interface BridgeFile {
  active: boolean;
  devices: Record<string, BridgeDevice>;
}

export const isInstalled = () => existsSync(path.join(INSTALL_DIR, "manifest.json"));

export async function readBridge(): Promise<BridgeFile> {
  try {
    return JSON.parse(await fs.readFile(path.join(INSTALL_DIR, "devices.json"), "utf8")) as BridgeFile;
  } catch {
    return { active: false, devices: {} };
  }
}

/** Copy the bridge plugin into OpenDeck's plugins folder (OpenDeck must be restarted to pick it up). */
export async function install(): Promise<void> {
  await fs.mkdir(INSTALL_DIR, { recursive: true });
  for (const file of await fs.readdir(SOURCE_DIR)) {
    if (file === "devices.json") continue;
    await fs.copyFile(path.join(SOURCE_DIR, file), path.join(INSTALL_DIR, file));
  }
}
