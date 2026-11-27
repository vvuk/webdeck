import { useRef, useState } from "react";

import type { Action, ActionCategory, ActionInstance, ActionState, DeviceSummary } from "../../shared/types.ts";
import { imageFromFile } from "../lib/images.ts";
import { controllerFor, type SlotRef } from "../lib/profile-ops.ts";
import { KeyFace } from "./KeyFace.tsx";
import { SettingsForm } from "./SettingsForm.tsx";

interface Props {
  slot: SlotRef;
  instance: ActionInstance | null;
  categories: ActionCategory[];
  devices: DeviceSummary[];
  device: string;
  profile: string;
  revision: number;
  /** An image dropped on an empty slot, waiting for an action to be chosen. */
  pendingImage: string | null;
  onPlaceAction: (action: Action) => void;
  onUpdateState: (index: number, patch: Partial<ActionState>, field: string) => void;
  onUpdateSettings: (settings: Record<string, unknown>, field: string) => void;
  onSetImage: (image: Promise<string>, stateIndex: number) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function Editor(props: Props) {
  const { slot, instance, categories } = props;
  const controller = controllerFor(slot.group);
  const [stateIndex, setStateIndex] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const state = instance?.states[stateIndex] ?? instance?.states[0];
  const index = instance && stateIndex < instance.states.length ? stateIndex : 0;

  const slotName = `${slot.group === "keys" ? "Key" : "Dial"} ${slot.index + 1}`;
  const compatible = categories
    .map((c) => ({ ...c, actions: c.actions.filter((a) => a.controllers.includes(controller)) }))
    .filter((c) => c.actions.length);

  const actionPicker = (
    <label className="field">
      <span>Action</span>
      <select
        value={instance ? `${instance.action.plugin}|${instance.action.uuid}` : ""}
        onChange={(e) => {
          const [plugin, uuid] = e.target.value.split("|");
          const action = compatible.flatMap((c) => c.actions).find((a) => a.plugin === plugin && a.uuid === uuid);
          if (action) props.onPlaceAction(action);
        }}
      >
        {!instance && <option value="">Choose an action…</option>}
        {instance && !compatible.some((c) => c.actions.some((a) => a.uuid === instance.action.uuid)) && (
          <option value={`${instance.action.plugin}|${instance.action.uuid}`}>{instance.action.name}</option>
        )}
        {compatible.map((c) => (
          <optgroup key={c.name} label={c.name}>
            {c.actions.map((a) => (
              <option key={a.uuid} value={`${a.plugin}|${a.uuid}`} title={a.tooltip}>
                {a.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );

  return (
    <aside className="editor">
      <header className="editor-header">
        <h2>{slotName}</h2>
        <button type="button" className="icon-button" onClick={props.onClose} aria-label="Close editor">
          ✕
        </button>
      </header>

      {!instance || !state ? (
        <section>
          {props.pendingImage && (
            <div className="pending-image">
              <img src={props.pendingImage} alt="" />
              <span>Pick an action to put this image on.</span>
            </div>
          )}
          {actionPicker}
          {!compatible.length && <p className="hint">No installed plugin offers actions for this control.</p>}
        </section>
      ) : (
        <>
          <section>
            {actionPicker}
            {instance.action.tooltip && <p className="hint">{instance.action.tooltip}</p>}
          </section>

          {instance.states.length > 1 && (
            <div className="tabs" role="tablist">
              {instance.states.map((s, i) => (
                <button
                  type="button"
                  key={i}
                  role="tab"
                  aria-selected={i === index}
                  className={i === index ? "active" : ""}
                  onClick={() => setStateIndex(i)}
                >
                  {s.name || `State ${i + 1}`}
                </button>
              ))}
            </div>
          )}

          <section>
            <h3>Behaviour</h3>
            {instance.children ? (
              <div className="children">
                <p className="hint">
                  {instance.action.name} with {instance.children.length} step{instance.children.length === 1 ? "" : "s"}. Edit
                  steps in OpenDeck; you can still move, copy and restyle it here.
                </p>
                <ol>
                  {instance.children.map((c) => (
                    <li key={c.context}>{c.action.name}</li>
                  ))}
                </ol>
              </div>
            ) : (
              <SettingsForm
                // Remount when the slot or action changes so local editor state (raw JSON, recorder) resets.
                key={`${slot.group}-${slot.index}-${instance.action.uuid}`}
                actionUuid={instance.action.uuid}
                controller={controller}
                settings={instance.settings ?? {}}
                onChange={(s) => props.onUpdateSettings(s, "settings")}
                devices={props.devices}
                currentDevice={props.device}
              />
            )}
          </section>

          <section>
            <h3>Appearance</h3>
            <div
              className="image-well"
              onClick={() => fileInput.current?.click()}
              title="Click to choose an image, or drop one on the key"
            >
              <KeyFace instance={instance} stateIndex={index} device={props.device} profile={props.profile} revision={props.revision} />
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) props.onSetImage(imageFromFile(file), index);
                e.target.value = "";
              }}
            />
            <div className="button-row">
              <button type="button" onClick={() => fileInput.current?.click()}>
                Choose image…
              </button>
              <button
                type="button"
                disabled={!state.image_override}
                onClick={() => props.onUpdateState(index, { image_override: null }, "image")}
              >
                Reset image
              </button>
            </div>
            <AppearanceFields state={state} onChange={(patch, field) => props.onUpdateState(index, patch, field)} />
          </section>

          <footer className="editor-footer">
            <button type="button" className="danger" onClick={props.onRemove}>
              Remove from {slot.group === "keys" ? "key" : "dial"}
            </button>
          </footer>
        </>
      )}
    </aside>
  );
}

function AppearanceFields({
  state,
  onChange,
}: {
  state: ActionState;
  onChange: (patch: Partial<ActionState>, field: string) => void;
}) {
  const bold = state.style.includes("Bold");
  const italic = state.style.includes("Italic");
  const setStyle = (b: boolean, i: boolean) =>
    onChange({ style: b && i ? "Bold Italic" : b ? "Bold" : i ? "Italic" : "Regular" }, "style");

  return (
    <div className="appearance">
      <div className="field">
        <label htmlFor="title">Title</label>
        <textarea
          id="title"
          rows={2}
          value={state.text_override ?? ""}
          placeholder={state.text || "No title"}
          onChange={(e) => onChange({ text_override: e.target.value || null }, "text_override")}
        />
      </div>
      <div className="field-grid">
        <label className="field field-inline">
          <input type="checkbox" checked={state.show} onChange={(e) => onChange({ show: e.target.checked }, "show")} />
          Show title
        </label>
        <label className="field">
          <span>Position</span>
          <select value={state.alignment} onChange={(e) => onChange({ alignment: e.target.value as ActionState["alignment"] }, "alignment")}>
            <option value="top">Top</option>
            <option value="middle">Middle</option>
            <option value="bottom">Bottom</option>
          </select>
        </label>
        <label className="field">
          <span>Size</span>
          <input
            type="number"
            min={4}
            max={96}
            value={state.size}
            onChange={(e) => onChange({ size: Math.max(1, Number(e.target.value) || 1) }, "size")}
          />
        </label>
        <label className="field">
          <span>Colour</span>
          <input type="color" value={toHex(state.colour)} onChange={(e) => onChange({ colour: e.target.value.toUpperCase() }, "colour")} />
        </label>
        <div className="field">
          <span>Style</span>
          <div className="toggle-group">
            <button type="button" className={bold ? "on" : ""} onClick={() => setStyle(!bold, italic)} aria-pressed={bold}>
              <b>B</b>
            </button>
            <button type="button" className={italic ? "on" : ""} onClick={() => setStyle(bold, !italic)} aria-pressed={italic}>
              <i>I</i>
            </button>
            <button
              type="button"
              className={state.underline ? "on" : ""}
              onClick={() => onChange({ underline: !state.underline }, "underline")}
              aria-pressed={state.underline}
            >
              <u>U</u>
            </button>
          </div>
        </div>
        <label className="field">
          <span>Outline</span>
          <div className="field-row">
            <input
              type="color"
              value={toHex(state.stroke_colour)}
              onChange={(e) => onChange({ stroke_colour: e.target.value.toUpperCase() }, "stroke_colour")}
            />
            <input
              type="number"
              min={0}
              max={20}
              value={state.stroke_size}
              onChange={(e) => onChange({ stroke_size: Math.max(0, Number(e.target.value) || 0) }, "stroke_size")}
              aria-label="Outline width"
            />
          </div>
        </label>
        <label className="field">
          <span>Background</span>
          <input
            type="color"
            value={toHex(state.background_colour)}
            onChange={(e) => onChange({ background_colour: e.target.value.toUpperCase() }, "background_colour")}
          />
        </label>
        <label className="field">
          <span>Image scale: {state.image_scale || 100}%</span>
          <input
            type="range"
            min={10}
            max={200}
            step={5}
            value={state.image_scale || 100}
            onChange={(e) => onChange({ image_scale: Number(e.target.value) }, "image_scale")}
          />
        </label>
      </div>
    </div>
  );
}

/** <input type="color"> only accepts #rrggbb; OpenDeck sometimes stores #rrggbbaa. */
const toHex = (colour: string) => (/^#[0-9a-f]{6}/i.test(colour) ? colour.slice(0, 7) : "#000000");
