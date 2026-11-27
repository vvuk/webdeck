import { useEffect, useState } from "react";

import type { Controller, DeviceSummary } from "../../shared/types.ts";
import { ACTION_FORMS, labelFor, type Field } from "../lib/action-forms.ts";
import { recordKeystroke } from "../lib/keystroke.ts";

interface Props {
  actionUuid: string;
  controller: Controller;
  settings: Record<string, unknown>;
  onChange: (settings: Record<string, unknown>) => void;
  devices: DeviceSummary[];
  currentDevice: string;
}

/** Native form for known actions, plus a raw JSON editor that always works (and preserves unknown keys). */
export function SettingsForm({ actionUuid, controller, settings, onChange, devices, currentDevice }: Props) {
  const form = ACTION_FORMS[actionUuid];
  const [showRaw, setShowRaw] = useState(!form);
  const fields = form?.fields.filter((f) => !f.controllers || f.controllers.includes(controller)) ?? [];
  const set = (key: string, value: unknown) => onChange({ ...settings, [key]: value });

  const profileDevice = String(settings.device ?? currentDevice);
  const profileOptions = devices.find((d) => d.id === profileDevice)?.profiles ?? [];

  return (
    <div className="settings-form">
      {fields.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          label={labelFor(field, controller)}
          value={settings[field.key]}
          onChange={(v) => set(field.key, v)}
          deviceIds={devices.map((d) => d.id)}
          currentDevice={currentDevice}
          profileOptions={profileOptions}
        />
      ))}

      {!form && <p className="hint">webdeck doesn't have a form for this action, so edit its settings as JSON.</p>}

      {form?.help && (
        <details className="help">
          <summary>{form.help.title}</summary>
          {form.help.lines.map((line) => (
            <code key={line}>{line}</code>
          ))}
        </details>
      )}

      {form && (
        <button type="button" className="link" onClick={() => setShowRaw((s) => !s)}>
          {showRaw ? "Hide" : "Show"} raw settings JSON
        </button>
      )}
      {showRaw && <RawJson value={settings} onChange={onChange} />}
    </div>
  );
}

interface FieldProps {
  field: Field;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  deviceIds: string[];
  currentDevice: string;
  profileOptions: string[];
}

function FieldInput({ field, label, value, onChange, deviceIds, currentDevice, profileOptions }: FieldProps) {
  const id = `field-${field.key}`;
  const str = value === undefined || value === null ? "" : String(value);

  switch (field.kind) {
    case "checkbox":
      return (
        <label className="field field-inline">
          <input type="checkbox" checked={Boolean(value ?? field.default)} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
      );
    case "select":
      return (
        <label className="field">
          <span>{label}</span>
          <select value={str || String(field.default ?? "")} onChange={(e) => onChange(e.target.value)}>
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "range": {
      const n = Number(value ?? field.default ?? 0);
      return (
        <label className="field">
          <span>
            {label}: <b>{n}</b>
          </span>
          <input type="range" min={field.min} max={field.max} value={n} onChange={(e) => onChange(Number(e.target.value))} />
        </label>
      );
    }
    case "device":
    case "profile": {
      const listId = `${id}-options`;
      const options = field.kind === "device" ? deviceIds : profileOptions;
      const fallback = field.kind === "device" ? currentDevice : String(field.default ?? "");
      return (
        <label className="field">
          <span>{label}</span>
          <input list={listId} value={str} placeholder={fallback} onChange={(e) => onChange(e.target.value)} />
          <datalist id={listId}>
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </label>
      );
    }
    default:
      return (
        <div className="field">
          <label htmlFor={id}>{label}</label>
          <div className="field-row">
            <input
              id={id}
              className={field.kind === "code" ? "mono" : ""}
              type={field.kind === "url" ? "url" : "text"}
              spellCheck={false}
              autoComplete="off"
              value={str}
              placeholder={field.placeholder}
              onChange={(e) => onChange(e.target.value)}
            />
            {field.recorder && <KeystrokeRecorder onRecord={(tokens) => onChange(tokens)} />}
          </div>
        </div>
      );
  }
}

/** Press a shortcut and get the token string for it. */
function KeystrokeRecorder({ onRecord }: { onRecord: (tokens: string) => void }) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false);
        return;
      }
      const recorded = recordKeystroke(e);
      if (recorded) {
        onRecord(recorded.tokens);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onRecord]);

  return (
    <button
      type="button"
      className={`record ${recording ? "recording" : ""}`}
      onClick={() => setRecording((r) => !r)}
      title="Record a key combination (Esc to cancel)"
    >
      {recording ? "Press keys…" : "⏺ Record"}
    </button>
  );
}

function RawJson({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const serialised = JSON.stringify(value, null, 2);
  const [text, setText] = useState(serialised);
  const [error, setError] = useState<string | null>(null);

  // Follow external changes (form edits, undo) unless the user is mid-edit with invalid JSON.
  useEffect(() => {
    setText((current) => {
      try {
        if (JSON.stringify(JSON.parse(current)) === JSON.stringify(value)) return current;
      } catch {
        if (error) return current;
      }
      return serialised;
    });
  }, [serialised, value, error]);

  return (
    <div className="field">
      <textarea
        className="mono raw-json"
        spellCheck={false}
        rows={Math.min(14, Math.max(4, text.split("\n").length))}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Settings must be a JSON object");
            setError(null);
            onChange(parsed);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
