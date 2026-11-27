import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ActionInstance, Profile } from "../shared/types.ts";

// config.ts reads OPENDECK_CONFIG_DIR at import time, so point it at a scratch dir before importing.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "webdeck-test-"));
process.env.OPENDECK_CONFIG_DIR = dir;
const { readProfile, writeProfile, currentHash, getSelectedProfile } = await import("./profiles.ts");

const DEV = "dev-1";
const PROF = "Main";
const imgDir = (ctx: string) => path.join(dir, "images", DEV, PROF, ctx);

const instance = (ctx: string, image_override: string | null, extra: Partial<ActionInstance> = {}): ActionInstance =>
  ({
    action: { name: "A", uuid: "a", plugin: "p", controllers: ["Keypad"], states: [] },
    context: ctx,
    states: [{ image: "plugins/p/icon.png", image_override, text: "" }],
    current_state: 0,
    settings: {},
    children: null,
    ...extra,
  }) as unknown as ActionInstance;

beforeAll(async () => {
  await fs.mkdir(path.join(dir, "profiles", DEV), { recursive: true });
  const profile: Profile = { keys: [instance("Keypad.0.0", "0-user.png"), instance("Keypad.1.0", "0-user.png"), null], sliders: [] };
  await fs.writeFile(path.join(dir, "profiles", DEV, `${PROF}.json`), JSON.stringify(profile));
  for (const [ctx, content] of [["Keypad.0.0", "A"], ["Keypad.1.0", "B"]]) {
    await fs.mkdir(imgDir(ctx), { recursive: true });
    await fs.writeFile(path.join(imgDir(ctx), "0-user.png"), content);
  }
});

afterAll(() => fs.rm(dir, { recursive: true, force: true }));

describe("writeProfile", () => {
  it("swaps images when two keys swap, copies on duplicate, writes data URLs, and cleans up", async () => {
    const { data, hash } = await readProfile(DEV, PROF);
    expect(await currentHash(DEV, PROF)).toBe(hash);

    const [a, b] = data.keys as ActionInstance[];
    const next: Profile = {
      ...data,
      keys: [
        { ...b, context: "Keypad.0.0", __origin: "Keypad.1.0" }, // B moved to 0
        { ...a, context: "Keypad.1.0", __origin: "Keypad.0.0" }, // A moved to 1
        { ...a, context: "Keypad.2.0", __origin: "Keypad.0.0" }, // copy of A at 2
      ],
    };
    await writeProfile(DEV, PROF, next, true);

    const read = (ctx: string, f = "0-user.png") => fs.readFile(path.join(imgDir(ctx), f), "utf8");
    expect(await read("Keypad.0.0")).toBe("B");
    expect(await read("Keypad.1.0")).toBe("A");
    expect(await read("Keypad.2.0")).toBe("A");

    const written = JSON.parse(await fs.readFile(path.join(dir, "profiles", DEV, `${PROF}.json`), "utf8")) as Profile;
    expect(written.keys.every((k) => k && !("__origin" in k))).toBe(true);
    expect(await getSelectedProfile(DEV)).toBe(PROF);

    // New image as a data URL on key 0; key 2 removed.
    const again: Profile = {
      ...written,
      keys: [instance("Keypad.0.0", "data:image/png;base64," + Buffer.from("NEW").toString("base64")), written.keys[1], null],
    };
    await writeProfile(DEV, PROF, again, false);
    expect(await read("Keypad.0.0", "0-user.png")).toBe("NEW");
    const final = JSON.parse(await fs.readFile(path.join(dir, "profiles", DEV, `${PROF}.json`), "utf8")) as Profile;
    expect(final.keys[0]?.states[0].image_override).toBe("0-user.png");
    await expect(fs.stat(imgDir("Keypad.2.0"))).rejects.toThrow();
  });

  it("rejects path traversal in profile ids", async () => {
    await expect(readProfile(DEV, "../../etc/passwd")).rejects.toThrow(/escapes/);
  });
});
