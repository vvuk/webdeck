import { describe, expect, it } from "vitest";

import type { Action, ActionInstance, Profile } from "../../shared/types.ts";
import { markOrigins, moveOrCopy, placeAction, updateState } from "./profile-ops.ts";

const state = (extra: Record<string, unknown> = {}) => ({
  image: "plugins/p/icon.png",
  image_override: null,
  image_scale: 100,
  background_colour: "#000000",
  name: "",
  text: "",
  text_override: null,
  show: true,
  colour: "#FFFFFF",
  stroke_colour: "#000000",
  alignment: "middle" as const,
  family: "Liberation Sans",
  style: "Regular",
  size: 16,
  stroke_size: 3,
  underline: false,
  ...extra,
});

const action = (uuid: string, controllers = ["Keypad"]): Action => ({
  name: uuid,
  uuid,
  plugin: "p",
  tooltip: "",
  icon: "plugins/p/icon.png",
  disable_automatic_states: false,
  visible_in_action_list: true,
  supported_in_multi_actions: true,
  property_inspector: "",
  controllers,
  encoder: null,
  states: [state()],
});

const instance = (uuid: string, context: string, extra: Partial<ActionInstance> = {}): ActionInstance => ({
  action: action(uuid),
  context,
  states: [state()],
  current_state: 0,
  settings: { down: uuid },
  children: null,
  ...extra,
});

const profile = (): Profile =>
  markOrigins({ keys: [instance("a", "Keypad.0.0"), instance("b", "Keypad.1.0"), null], sliders: [null] });

describe("moveOrCopy", () => {
  it("moves into an empty slot and keeps the image origin", () => {
    const next = moveOrCopy(profile(), { group: "keys", index: 0 }, { group: "keys", index: 2 }, "move");
    expect(next.keys[0]).toBeNull();
    expect(next.keys[2]?.context).toBe("Keypad.2.0");
    expect(next.keys[2]?.__origin).toBe("Keypad.0.0");
  });

  it("swaps when the target is occupied", () => {
    const next = moveOrCopy(profile(), { group: "keys", index: 0 }, { group: "keys", index: 1 }, "move");
    expect(next.keys[0]?.settings.down).toBe("b");
    expect(next.keys[0]?.context).toBe("Keypad.0.0");
    expect(next.keys[1]?.settings.down).toBe("a");
    expect(next.keys[1]?.context).toBe("Keypad.1.0");
  });

  it("copies as an independent deep clone", () => {
    const start = profile();
    const copied = moveOrCopy(start, { group: "keys", index: 0 }, { group: "keys", index: 2 }, "copy");
    expect(copied.keys[0]?.settings.down).toBe("a");
    expect(copied.keys[2]?.settings.down).toBe("a");
    const edited = updateState(copied, { group: "keys", index: 2 }, 0, { text_override: "hi" });
    expect(edited.keys[0]?.states[0].text_override).toBeNull();
    expect(start.keys[2]).toBeNull();
  });

  it("refuses to put a keypad-only action on a dial", () => {
    const start = profile();
    expect(moveOrCopy(start, { group: "keys", index: 0 }, { group: "sliders", index: 0 }, "move")).toBe(start);
  });

  it("renumbers multi-action children", () => {
    const start = markOrigins({
      keys: [instance("m", "Keypad.0.0", { children: [instance("c", "Keypad.0.1")] }), null],
      sliders: [],
    });
    const next = moveOrCopy(start, { group: "keys", index: 0 }, { group: "keys", index: 1 }, "move");
    expect(next.keys[1]?.children?.[0].context).toBe("Keypad.1.1");
    expect(next.keys[1]?.children?.[0].__origin).toBe("Keypad.0.1");
  });
});

describe("placeAction", () => {
  it("creates a fresh instance in an empty slot", () => {
    const next = placeAction(profile(), { group: "keys", index: 2 }, action("new"));
    expect(next.keys[2]?.action.uuid).toBe("new");
    expect(next.keys[2]?.__origin).toBeNull();
    expect(next.keys[2]?.settings).toEqual({});
  });

  it("carries the user's image and title over when replacing an action", () => {
    let start = updateState(profile(), { group: "keys", index: 0 }, 0, { image_override: "0-user.png", text_override: "Go" });
    start = placeAction(start, { group: "keys", index: 0 }, action("new"));
    expect(start.keys[0]?.states[0].image_override).toBe("0-user.png");
    expect(start.keys[0]?.states[0].text_override).toBe("Go");
    expect(start.keys[0]?.__origin).toBe("Keypad.0.0");
  });
});
