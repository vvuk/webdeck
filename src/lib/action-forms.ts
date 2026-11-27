// Settings forms for actions whose settings shape we know. OpenDeck normally shows each plugin's own HTML property
// inspector; we can't host those (they talk to OpenDeck over its plugin socket), so known plugins get a native form
// here and everything else gets a raw JSON editor.
//
// To support another plugin, add an entry keyed by action UUID. Field keys are the plugin's settings keys.

import type { Controller } from "../../shared/types.ts";

export type FieldKind = "code" | "text" | "url" | "checkbox" | "select" | "range" | "device" | "profile";

export interface Field {
  key: string;
  label: string | ((controller: Controller) => string);
  kind: FieldKind;
  placeholder?: string;
  /** Only show for these controllers (e.g. rotation handlers only make sense on dials). */
  controllers?: Controller[];
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  default?: string | number | boolean;
  /** Offer the keystroke recorder next to this field (input simulation). */
  recorder?: boolean;
}

export interface ActionForm {
  fields: Field[];
  /** Short help shown under the form. */
  help?: { title: string; lines: string[] };
}

const pressLabel = (what: "down" | "up") => (c: Controller) =>
  c === "Encoder" ? `Dial ${what === "down" ? "press" : "release"}` : `Key ${what === "down" ? "press" : "release"}`;

const ENCODER: Controller[] = ["Encoder"];

const SP = "com.amansprojects.starterpack";

export const ACTION_FORMS: Record<string, ActionForm> = {
  [`${SP}.inputsimulation`]: {
    fields: [
      { key: "down", label: pressLabel("down"), kind: "code", recorder: true, placeholder: "[k(Unicode('a'))]" },
      { key: "up", label: pressLabel("up"), kind: "code", recorder: true },
      { key: "anticlockwise", label: "Rotate anticlockwise", kind: "code", controllers: ENCODER, recorder: true },
      { key: "clockwise", label: "Rotate clockwise", kind: "code", controllers: ENCODER, recorder: true },
    ],
    help: {
      title: "Input syntax (enigo tokens, RON list)",
      lines: [
        "[t(\"hello\")]  type text",
        "[k(Unicode('a'))]  tap a key",
        "[k(Meta, Press), k(Unicode('c')), k(Meta, Release)]  ⌘C / Win+C",
        "[k(Control, Press), k(Shift, Press), k(Escape), k(Shift, Release), k(Control, Release)]",
        "Named keys: Return Tab Space Backspace Escape Delete Home End PageUp PageDown UpArrow DownArrow LeftArrow RightArrow F1…F20 CapsLock Meta Control Shift Alt",
        "[b(Left)]  click mouse   ·   [m(100, 200, Abs)]  move mouse   ·   [s(-3, Vertical)]  scroll",
        "Tip: use ⏺ Record to capture a shortcut.",
      ],
    },
  },
  [`${SP}.runcommand`]: {
    fields: [
      { key: "down", label: pressLabel("down"), kind: "code", placeholder: "open -a Calculator" },
      { key: "up", label: pressLabel("up"), kind: "code" },
      { key: "rotate", label: "Rotate", kind: "code", controllers: ENCODER, placeholder: "echo %d" },
      { key: "file", label: "Write output to file", kind: "text", placeholder: "/tmp/output.txt" },
      { key: "show", label: "Show output on key", kind: "checkbox", default: false },
    ],
    help: {
      title: "Run Command",
      lines: ["Commands run through your shell.", "On dials, %d in Rotate is replaced by the ticks turned (negative = anticlockwise)."],
    },
  },
  [`${SP}.openurl`]: {
    fields: [
      { key: "down", label: pressLabel("down"), kind: "url", placeholder: "https://example.com" },
      { key: "up", label: pressLabel("up"), kind: "url" },
      { key: "anticlockwise", label: "Rotate anticlockwise", kind: "url", controllers: ENCODER },
      { key: "clockwise", label: "Rotate clockwise", kind: "url", controllers: ENCODER },
    ],
  },
  [`${SP}.switchprofile`]: {
    fields: [
      { key: "device", label: "Device", kind: "device" },
      { key: "profile", label: (c) => (c === "Encoder" ? "Profile on dial press" : "Profile"), kind: "profile", default: "Default" },
      { key: "anticlockwise", label: "Profile on rotate anticlockwise", kind: "profile", controllers: ENCODER, default: "Default" },
      { key: "clockwise", label: "Profile on rotate clockwise", kind: "profile", controllers: ENCODER, default: "Default" },
    ],
  },
  [`${SP}.devicebrightness`]: {
    fields: [
      {
        key: "action",
        label: "Action",
        kind: "select",
        default: "set",
        options: [
          { value: "set", label: "Set to" },
          { value: "increase", label: "Increase by" },
          { value: "decrease", label: "Decrease by" },
        ],
      },
      { key: "value", label: "Value (%)", kind: "range", min: 0, max: 100, default: 50 },
    ],
  },
};

export const labelFor = (field: Field, controller: Controller) =>
  typeof field.label === "function" ? field.label(controller) : field.label;
