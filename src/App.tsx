import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Action, ActionCategory, DeviceSummary, Profile, StatusResponse } from "../shared/types.ts";
import { api, RequestError } from "./api.ts";
import { DeckView } from "./components/DeckView.tsx";
import { Editor } from "./components/Editor.tsx";
import { resolveLayout } from "./lib/layout.ts";
import {
  getSlot,
  markOrigins,
  moveOrCopy,
  placeAction,
  removeSlot,
  sameRef,
  updateSettings,
  updateState,
  type SlotRef,
} from "./lib/profile-ops.ts";
import { useHistory } from "./lib/use-history.ts";

const EMPTY: Profile = { keys: [], sliders: [] };

interface Loaded {
  device: string;
  profile: string;
  hash: string;
}

type Notice = { kind: "error" | "info" | "success"; text: string } | null;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [categories, setCategories] = useState<ActionCategory[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(() => localStorage.getItem("webdeck.device"));
  const [profileId, setProfileId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const [pendingImage, setPendingImage] = useState<{ ref: SlotRef; image: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [conflict, setConflict] = useState(false);
  const [activate, setActivate] = useState(false);
  const [columnsOverride, setColumnsOverride] = useState<Record<string, number>>(() =>
    JSON.parse(localStorage.getItem("webdeck.columns") ?? "{}"),
  );
  const history = useHistory<Profile>(EMPTY);
  const profile = history.value;

  // ---- Loading

  const refresh = useCallback(async () => {
    const [s, d] = await Promise.all([api.status(), api.devices()]);
    setStatus(s);
    setDevices(d);
    return d;
  }, []);

  useEffect(() => {
    refresh()
      .then((d) => {
        setDeviceId((current) => (current && d.some((x) => x.id === current) ? current : (d[0]?.id ?? null)));
      })
      .catch((e) => setNotice({ kind: "error", text: `Can't reach the webdeck server: ${e.message}` }));
    api.actions().then(setCategories).catch(() => undefined);
    const timer = setInterval(() => refresh().catch(() => undefined), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const device = devices.find((d) => d.id === deviceId) ?? null;

  // Pick the device's active profile when switching devices.
  useEffect(() => {
    if (!device) return;
    localStorage.setItem("webdeck.device", device.id);
    setProfileId((current) =>
      current && device.profiles.includes(current) && loaded?.device === device.id
        ? current
        : (device.selectedProfile && device.profiles.includes(device.selectedProfile) ? device.selectedProfile : device.profiles[0]) ??
          null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id, device?.profiles.join("|")]);

  const loadProfile = useCallback(
    async (dev: string, prof: string) => {
      setBusy("Loading…");
      try {
        const res = await api.profile(dev, prof);
        history.reset(markOrigins(res.data));
        setLoaded({ device: dev, profile: prof, hash: res.hash });
        setRevision((r) => r + 1);
        setSelected(null);
        setPendingImage(null);
        setConflict(false);
      } catch (e) {
        setNotice({ kind: "error", text: (e as Error).message });
      } finally {
        setBusy(null);
      }
    },
    [history.reset],
  );

  useEffect(() => {
    if (deviceId && profileId && (loaded?.device !== deviceId || loaded?.profile !== profileId)) {
      void loadProfile(deviceId, profileId);
    }
  }, [deviceId, profileId, loaded, loadProfile]);

  const confirmDiscard = () => !history.dirty || confirm("Discard your unapplied changes?");

  // ---- Editing

  const onMoveOrCopy = useCallback(
    (from: SlotRef, to: SlotRef, mode: "move" | "copy") => history.change((p) => moveOrCopy(p, from, to, mode)),
    [history.change],
  );

  // Event handlers need the latest profile without re-subscribing on every edit.
  const profileRef = useRef(profile);
  profileRef.current = profile;

  /** Set a key's image. Defaults to the state currently shown; an empty slot keeps the image until an action is picked. */
  const onImageDrop = useCallback(
    async (ref: SlotRef, image: Promise<string>, stateIndex?: number) => {
      try {
        const dataUrl = await image;
        const slot = getSlot(profileRef.current, ref);
        if (slot) {
          const index = stateIndex ?? slot.current_state ?? 0;
          history.change((p) => updateState(p, ref, index, { image_override: dataUrl }));
        } else {
          setPendingImage({ ref, image: dataUrl });
        }
        setSelected(ref);
      } catch (e) {
        setNotice({ kind: "error", text: `Couldn't use that image: ${(e as Error).message}` });
      }
    },
    [history.change],
  );

  const onPlaceAction = (action: Action) => {
    if (!selected) return;
    const image = pendingImage && sameRef(pendingImage.ref, selected) ? pendingImage.image : null;
    history.change((p) => {
      const next = placeAction(p, selected, action);
      return image ? updateState(next, selected, 0, { image_override: image }) : next;
    });
    setPendingImage(null);
  };

  const removeSelected = useCallback(() => {
    if (selected) history.change((p) => removeSlot(p, selected));
  }, [selected, history.change]);

  // ---- Saving

  const save = useCallback(
    async (force = false) => {
      if (!loaded || busy) return;
      setBusy(status?.openDeckRunning ? "Applying — restarting OpenDeck…" : "Saving…");
      setNotice(null);
      try {
        const res = await api.saveProfile(loaded.device, loaded.profile, {
          data: profile,
          baseHash: loaded.hash,
          force,
          activate,
        });
        history.reset(markOrigins(res.data));
        setLoaded({ ...loaded, hash: res.hash });
        setRevision((r) => r + 1);
        setConflict(false);
        setActivate(false);
        setNotice({
          kind: "success",
          text: res.restarted ? "Applied. OpenDeck restarted with your changes." : "Saved. Changes apply when OpenDeck starts.",
        });
        void refresh();
      } catch (e) {
        if (e instanceof RequestError && e.code === "conflict") setConflict(true);
        else setNotice({ kind: "error", text: (e as Error).message });
      } finally {
        setBusy(null);
      }
    },
    [loaded, busy, status?.openDeckRunning, profile, activate, history.reset, refresh],
  );

  // ---- Keyboard shortcuts & unload guard

  const shortcuts = useRef({ save, removeSelected, history });
  shortcuts.current = { save, removeSelected, history };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const { save, removeSelected, history } = shortcuts.current;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (history.dirty) void save();
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        history.redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        removeSelected();
      } else if (e.key === "Escape") {
        setSelected(null);
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (shortcuts.current.history.dirty) e.preventDefault();
    };
    // Dropping a file anywhere other than a key shouldn't navigate away to it.
    const swallow = (e: DragEvent) => e.preventDefault();
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  // ---- Layout

  const layout = useMemo(
    () => resolveLayout(device, profile.keys.length, device ? columnsOverride[device.id] : undefined),
    [device, profile.keys.length, columnsOverride],
  );

  const setColumns = (columns: number) => {
    if (!device) return;
    const next = { ...columnsOverride, [device.id]: columns };
    setColumnsOverride(next);
    localStorage.setItem("webdeck.columns", JSON.stringify(next));
  };

  const selectedInstance = selected ? getSlot(profile, selected) : null;
  const ready = loaded && deviceId === loaded.device && profileId === loaded.profile;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          webdeck
        </div>

        <label className="picker">
          <span>Deck</span>
          <select
            value={deviceId ?? ""}
            onChange={(e) => {
              if (!confirmDiscard()) return;
              setLoaded(null);
              setDeviceId(e.target.value);
            }}
          >
            {!devices.length && <option value="">No decks found</option>}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.connected ? "● " : "○ "}
                {d.name}
                {d.name !== d.id ? ` (${d.id})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="picker">
          <span>Profile</span>
          <select
            value={profileId ?? ""}
            onChange={(e) => {
              if (!confirmDiscard()) return;
              setProfileId(e.target.value);
            }}
          >
            {device?.profiles.map((p) => (
              <option key={p} value={p}>
                {p}
                {p === device.selectedProfile ? " (active)" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="topbar-spacer" />

        <div className="status-pills">
          <span className={`pill ${status?.openDeckRunning ? "ok" : "off"}`}>
            OpenDeck {status?.openDeckRunning ? "running" : "stopped"}
          </span>
          {status && <span className={`pill ${status.bridgeActive ? "ok" : "off"}`}>Bridge {status.bridgeActive ? "active" : "inactive"}</span>}
        </div>

        <div className="history-buttons">
          <button type="button" onClick={history.undo} disabled={!history.canUndo} title="Undo (⌘Z)">
            ↶
          </button>
          <button type="button" onClick={history.redo} disabled={!history.canRedo} title="Redo (⇧⌘Z)">
            ↷
          </button>
        </div>

        {device && profileId && profileId !== device.selectedProfile && (
          <label className="activate" title="Also make this the profile shown on the deck">
            <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
            Make active
          </label>
        )}
        <button
          type="button"
          className="primary"
          disabled={!ready || (!history.dirty && !activate) || !!busy}
          onClick={() => void save()}
          title={status?.openDeckRunning ? "Writes the profile and restarts OpenDeck (⌘S)" : "Writes the profile (⌘S)"}
        >
          {history.dirty ? "Apply to OpenDeck" : "No changes"}
        </button>
      </header>

      <Banners
        status={status}
        onInstallBridge={async () => {
          setBusy("Installing bridge — restarting OpenDeck…");
          try {
            await api.installBridge();
            setNotice({ kind: "success", text: "Bridge installed. Deck layouts will appear in a moment." });
            setTimeout(() => void refresh(), 3000);
          } catch (e) {
            setNotice({ kind: "error", text: (e as Error).message });
          } finally {
            setBusy(null);
          }
        }}
      />

      {conflict && (
        <div className="banner warn">
          <span>This profile was changed in OpenDeck since you loaded it.</span>
          <button type="button" onClick={() => void save(true)}>
            Overwrite with mine
          </button>
          <button type="button" onClick={() => loaded && void loadProfile(loaded.device, loaded.profile)}>
            Discard mine &amp; reload
          </button>
        </div>
      )}
      {notice && (
        <div className={`banner ${notice.kind}`} role="status">
          <span>{notice.text}</span>
          <button type="button" className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <main className="workspace">
        <section className="stage" onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
          {ready && device ? (
            <>
              <DeckView
                profile={profile}
                device={loaded.device}
                profileId={loaded.profile}
                revision={revision}
                rows={layout.rows}
                columns={layout.columns}
                selected={selected}
                onSelect={setSelected}
                onMoveOrCopy={onMoveOrCopy}
                onImageDrop={onImageDrop}
              />
              <p className="stage-hint">
                Click a key to edit · drag to move (swaps if occupied) · <kbd>Ctrl</kbd>/<kbd>⌥</kbd>-drag to copy · drop an image on a key to
                set it
              </p>
              {!layout.known && (
                <label className="layout-override">
                  Layout unknown ({profile.keys.length} keys) — columns:
                  <input
                    type="number"
                    min={1}
                    max={profile.keys.length || 1}
                    value={layout.columns}
                    onChange={(e) => setColumns(Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
              )}
            </>
          ) : (
            <div className="empty-state">{busy ?? (devices.length ? "Choose a deck" : "No OpenDeck profiles found")}</div>
          )}
        </section>

        {selected && ready && device && (
          <Editor
            key={`${selected.group}-${selected.index}`}
            slot={selected}
            instance={selectedInstance}
            categories={categories}
            devices={devices}
            device={loaded.device}
            profile={loaded.profile}
            revision={revision}
            pendingImage={pendingImage && sameRef(pendingImage.ref, selected) ? pendingImage.image : null}
            onPlaceAction={onPlaceAction}
            onUpdateState={(index, patch, field) =>
              history.change((p) => updateState(p, selected, index, patch), `${selected.group}${selected.index}:${index}:${field}`)
            }
            onUpdateSettings={(settings, field) =>
              history.change((p) => updateSettings(p, selected, settings), `${selected.group}${selected.index}:${field}`)
            }
            onSetImage={(image, index) => void onImageDrop(selected, image, index)}
            onRemove={removeSelected}
            onClose={() => setSelected(null)}
          />
        )}
      </main>

      {busy && ready && (
        <div className="overlay">
          <div className="overlay-card">
            <span className="spinner" aria-hidden />
            {busy}
          </div>
        </div>
      )}
    </div>
  );
}

function Banners({ status, onInstallBridge }: { status: StatusResponse | null; onInstallBridge: () => void }) {
  if (!status) return null;
  if (!status.configDirExists) {
    return (
      <div className="banner error">
        OpenDeck's config folder wasn't found at <code>{status.configDir}</code>. Set OPENDECK_CONFIG_DIR if it lives elsewhere.
      </div>
    );
  }
  return (
    <>
      {!status.bridgeInstalled && (
        <div className="banner info">
          <span>
            Install the webdeck bridge plugin into OpenDeck so webdeck can see which decks are connected and how their keys are laid out.
            This restarts OpenDeck.
          </span>
          <button type="button" onClick={onInstallBridge}>
            Install bridge
          </button>
        </div>
      )}
      {!status.openDeckRunning && (
        <div className="banner info">OpenDeck isn't running. Changes are written straight to its config and take effect when it starts.</div>
      )}
    </>
  );
}
