// Convert a recorded key combination into the enigo token syntax used by the Starter Pack's "Simulate Input" action.

const NAMED: Record<string, string> = {
  Enter: "Return",
  Tab: "Tab",
  Space: "Space",
  Backspace: "Backspace",
  Escape: "Escape",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "UpArrow",
  ArrowDown: "DownArrow",
  ArrowLeft: "LeftArrow",
  ArrowRight: "RightArrow",
  CapsLock: "CapsLock",
};

const MODIFIERS: [keyof KeyboardEvent, string][] = [
  ["metaKey", "Meta"],
  ["ctrlKey", "Control"],
  ["altKey", "Alt"],
  ["shiftKey", "Shift"],
];

const MODIFIER_CODES = /^(Meta|OS|Control|Alt|Shift)(Left|Right)?$/;

const ronChar = (c: string) => `'${c === "'" || c === "\\" ? "\\" + c : c}'`;

/** The non-modifier key, as an enigo Key, or null if the event is only a modifier press. */
function mainKey(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.test(e.code)) return null;
  if (NAMED[e.code]) return NAMED[e.code];
  if (/^F\d{1,2}$/.test(e.code)) return e.code;
  // Use the physical key so ⌥/⇧ don't turn "4" into "¢" or "$".
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1];
  if (letter) return `Unicode(${ronChar(letter.toLowerCase())})`;
  const digit = /^Digit(\d)$/.exec(e.code)?.[1];
  if (digit) return `Unicode(${ronChar(digit)})`;
  if (e.key.length === 1) return `Unicode(${ronChar(e.key.toLowerCase())})`;
  return null;
}

export interface Recorded {
  tokens: string;
  label: string;
}

const LABELS: Record<string, string> = { Meta: "⌘", Control: "⌃", Alt: "⌥", Shift: "⇧" };

export function recordKeystroke(e: KeyboardEvent): Recorded | null {
  const key = mainKey(e);
  if (!key) return null;
  const mods = MODIFIERS.filter(([prop]) => e[prop]).map(([, name]) => name);
  const tokens = [
    ...mods.map((m) => `k(${m}, Press)`),
    `k(${key})`,
    ...[...mods].reverse().map((m) => `k(${m}, Release)`),
  ];
  const keyLabel = key.startsWith("Unicode(") ? key.slice(9, -2).toUpperCase() : key;
  return { tokens: `[${tokens.join(", ")}]`, label: mods.map((m) => LABELS[m]).join("") + keyLabel };
}
