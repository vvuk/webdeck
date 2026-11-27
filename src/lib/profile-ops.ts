// Pure, immutable operations on a profile. Every function returns a new Profile and never mutates its input, which is
// what makes undo/redo a simple stack of snapshots.

import type { Action, ActionInstance, ActionState, Controller, Profile, Slot } from "../../shared/types.ts";

export type SlotGroup = "keys" | "sliders";

export interface SlotRef {
  group: SlotGroup;
  index: number;
}

export const controllerFor = (group: SlotGroup): Controller => (group === "keys" ? "Keypad" : "Encoder");

export const sameRef = (a: SlotRef | null, b: SlotRef | null) => !!a && !!b && a.group === b.group && a.index === b.index;

export const getSlot = (profile: Profile, ref: SlotRef): Slot => profile[ref.group][ref.index] ?? null;

const clone = <T>(value: T): T => structuredClone(value);

function withSlot(profile: Profile, ref: SlotRef, slot: Slot): Profile {
  const list = [...profile[ref.group]];
  while (list.length <= ref.index) list.push(null);
  list[ref.index] = slot;
  return { ...profile, [ref.group]: list };
}

/** Record where each instance's images currently live. Call on every profile freshly loaded from the server. */
export function markOrigins(profile: Profile): Profile {
  const mark = (slot: Slot): Slot =>
    slot && {
      ...slot,
      __origin: slot.context,
      children: slot.children?.map((c) => ({ ...c, __origin: c.context })) ?? slot.children,
    };
  return { ...profile, keys: profile.keys.map(mark), sliders: profile.sliders.map(mark) };
}

/** Give an instance (and its multi-action children) the context of a new slot, keeping `__origin` so images follow. */
function relocate(instance: ActionInstance, ref: SlotRef): ActionInstance {
  const controller = controllerFor(ref.group);
  const childIndex = (context: string) => context.split(".").at(-1) ?? "0";
  return {
    ...instance,
    context: `${controller}.${ref.index}.0`,
    children:
      instance.children?.map((child) => ({ ...child, context: `${controller}.${ref.index}.${childIndex(child.context)}` })) ??
      instance.children,
  };
}

export const canPlace = (instance: ActionInstance, ref: SlotRef) =>
  instance.action.controllers.includes(controllerFor(ref.group));

/**
 * Move or copy the instance at `from` onto `to`.
 * - move: if `to` is occupied the two swap places.
 * - copy: `to` is replaced by a duplicate of `from`.
 * Returns the profile unchanged if the action can't live on the target controller.
 */
export function moveOrCopy(profile: Profile, from: SlotRef, to: SlotRef, mode: "move" | "copy"): Profile {
  if (sameRef(from, to)) return profile;
  const source = getSlot(profile, from);
  if (!source || !canPlace(source, to)) return profile;
  const target = getSlot(profile, to);

  if (mode === "copy") {
    return withSlot(profile, to, relocate(clone(source), to));
  }
  if (target && !canPlace(target, from)) return profile;
  let next = withSlot(profile, to, relocate(source, to));
  next = withSlot(next, from, target ? relocate(target, from) : null);
  return next;
}

export const removeSlot = (profile: Profile, ref: SlotRef): Profile => withSlot(profile, ref, null);

export function updateSlot(profile: Profile, ref: SlotRef, update: (instance: ActionInstance) => ActionInstance): Profile {
  const slot = getSlot(profile, ref);
  return slot ? withSlot(profile, ref, update(slot)) : profile;
}

export function updateState(profile: Profile, ref: SlotRef, stateIndex: number, patch: Partial<ActionState>): Profile {
  return updateSlot(profile, ref, (instance) => ({
    ...instance,
    states: instance.states.map((s, i) => (i === stateIndex ? { ...s, ...patch } : s)),
  }));
}

export function updateSettings(profile: Profile, ref: SlotRef, settings: Record<string, unknown>): Profile {
  return updateSlot(profile, ref, (instance) => ({ ...instance, settings }));
}

/** Appearance fields the user controls; carried over when a key's action is changed. */
const USER_STATE_FIELDS = [
  "image_override",
  "image_scale",
  "background_colour",
  "text_override",
  "show",
  "colour",
  "stroke_colour",
  "alignment",
  "family",
  "style",
  "size",
  "stroke_size",
  "underline",
] as const;

/**
 * Put a new instance of `action` in a slot. If the slot already held something, the user's appearance customisations
 * (image, title, colours...) are carried over, since swapping what a key *does* rarely means you want to restyle it.
 */
export function placeAction(profile: Profile, ref: SlotRef, action: Action): Profile {
  const previous = getSlot(profile, ref);
  const states = clone(action.states).map((state, i) => {
    const old = previous?.states[i];
    if (!old) return state;
    const carried: Partial<ActionState> = {};
    for (const field of USER_STATE_FIELDS) (carried as Record<string, unknown>)[field] = old[field];
    return { ...state, ...carried };
  });

  const isGroup = action.uuid === "opendeck.multiaction" || action.uuid === "opendeck.toggleaction";
  const instance: ActionInstance = {
    action: clone(action),
    context: `${controllerFor(ref.group)}.${ref.index}.0`,
    states,
    current_state: 0,
    settings: {},
    children: isGroup ? [] : null,
    // Keep the old image directory if we carried an image over from it; otherwise start clean.
    __origin: previous ? (previous.__origin === undefined ? previous.context : previous.__origin) : null,
  };
  return withSlot(profile, ref, instance);
}

/** The text OpenDeck draws on the key. */
export const displayTitle = (state: ActionState) => state.text_override || state.text;
