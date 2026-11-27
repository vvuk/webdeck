import { useCallback, useEffect, useRef, useState } from "react";

import type { Profile } from "../../shared/types.ts";
import { dragHasImage, imageFromDrop } from "../lib/images.ts";
import { canPlace, getSlot, sameRef, type SlotGroup, type SlotRef } from "../lib/profile-ops.ts";
import { KeyFace } from "./KeyFace.tsx";

interface Props {
  profile: Profile;
  device: string;
  profileId: string;
  revision: number;
  rows: number;
  columns: number;
  selected: SlotRef | null;
  onSelect: (ref: SlotRef | null) => void;
  onMoveOrCopy: (from: SlotRef, to: SlotRef, mode: "move" | "copy") => void;
  onImageDrop: (ref: SlotRef, image: Promise<string>) => void;
}

interface DragState {
  from: SlotRef;
  x: number;
  y: number;
  over: SlotRef | null;
  copy: boolean;
}

const DRAG_THRESHOLD = 5;
/** Ctrl is what was asked for; ⌥ is the macOS convention for copy-drag, and ⌘ is accepted too. */
const isCopyModifier = (e: { ctrlKey: boolean; altKey: boolean; metaKey: boolean }) => e.ctrlKey || e.altKey || e.metaKey;

function refFromPoint(x: number, y: number): SlotRef | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-slot-group]");
  if (!el) return null;
  return { group: el.dataset.slotGroup as SlotGroup, index: Number(el.dataset.slotIndex) };
}

export function DeckView(props: Props) {
  const { profile, rows, columns, selected, onSelect, onMoveOrCopy, onImageDrop } = props;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [fileOver, setFileOver] = useState<SlotRef | null>(null);
  const pending = useRef<{ from: SlotRef; startX: number; startY: number; pointerId: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  // --- Internal move/copy drags use pointer events (HTML5 drag-and-drop can't do ctrl-drag on macOS, where
  // ctrl+click is a right-click, and gives poor control over the drag image).

  const endDrag = useCallback(() => {
    pending.current = null;
    setDrag(null);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (!dragRef.current && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD) return;
      setDrag({ from: p.from, x: e.clientX, y: e.clientY, over: refFromPoint(e.clientX, e.clientY), copy: isCopyModifier(e) });
    };
    const onUp = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      const d = dragRef.current;
      if (d) {
        const to = refFromPoint(e.clientX, e.clientY);
        if (to && !sameRef(to, d.from)) {
          onMoveOrCopy(d.from, to, isCopyModifier(e) ? "copy" : "move");
          onSelect(to);
        }
      } else {
        onSelect(p.from);
      }
      endDrag();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!dragRef.current) return;
      if (e.key === "Escape") endDrag();
      else setDrag({ ...dragRef.current, copy: isCopyModifier(e) });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [onMoveOrCopy, onSelect, endDrag]);

  const onPointerDown = (ref: SlotRef) => (e: React.PointerEvent) => {
    // Some macOS browsers report ctrl+click as the secondary button.
    if (e.button !== 0 && !(e.button === 2 && e.ctrlKey)) return;
    e.preventDefault(); // no text selection / native image drag
    if (!getSlot(profile, ref)) {
      onSelect(ref);
      return;
    }
    pending.current = { from: ref, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId };
  };

  // --- External drops (files from Finder/Explorer, images from other web pages) use HTML5 drag events.

  const fileHandlers = (ref: SlotRef) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragHasImage(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!sameRef(fileOver, ref)) setFileOver(ref);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileOver((cur) => (sameRef(cur, ref) ? null : cur));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setFileOver(null);
      const image = imageFromDrop(e.dataTransfer);
      if (image) onImageDrop(ref, image);
    },
  });

  const dragSource = drag ? getSlot(profile, drag.from) : null;

  const renderSlot = (group: SlotGroup, index: number, extraClass = "") => {
    const ref = { group, index };
    const instance = getSlot(profile, ref);
    const isSelected = sameRef(selected, ref);
    const isDropTarget = drag && sameRef(drag.over, ref) && !sameRef(drag.from, ref);
    const invalid = isDropTarget && dragSource && !canPlace(dragSource, ref);
    const classes = [
      "slot",
      group === "sliders" ? "dial" : "key",
      extraClass,
      instance ? "filled" : "empty",
      isSelected && "selected",
      isDropTarget && (invalid ? "drop-invalid" : drag.copy ? "drop-copy" : "drop-move"),
      drag && sameRef(drag.from, ref) && !drag.copy && "drag-source",
      sameRef(fileOver, ref) && "file-over",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        key={`${group}-${index}`}
        className={classes}
        data-slot-group={group}
        data-slot-index={index}
        title={instance ? `${instance.action.name}${instance.action.tooltip ? ` — ${instance.action.tooltip}` : ""}` : "Empty"}
        onPointerDown={onPointerDown(ref)}
        onContextMenu={(e) => e.preventDefault()}
        {...fileHandlers(ref)}
      >
        {instance ? (
          <KeyFace instance={instance} device={props.device} profile={props.profileId} revision={props.revision} />
        ) : (
          <span className="slot-plus">+</span>
        )}
        <span className="slot-index">{index + 1}</span>
      </div>
    );
  };

  const gridCount = rows * columns;
  const extraKeys = Math.max(0, profile.keys.length - gridCount);

  return (
    <div className={`deck ${drag ? "dragging" : ""}`}>
      <div className="deck-grid" style={{ gridTemplateColumns: `repeat(${columns}, var(--key-size))` }}>
        {Array.from({ length: gridCount }, (_, i) => renderSlot("keys", i))}
      </div>

      {extraKeys > 0 && (
        <div className="deck-row">
          <span className="deck-row-label">Touch</span>
          {Array.from({ length: extraKeys }, (_, i) => renderSlot("keys", gridCount + i, "touch"))}
        </div>
      )}

      {profile.sliders.length > 0 && (
        <div className="deck-row">
          <span className="deck-row-label">Dials</span>
          {profile.sliders.map((_, i) => renderSlot("sliders", i))}
        </div>
      )}

      {drag && dragSource && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          <KeyFace instance={dragSource} device={props.device} profile={props.profileId} revision={props.revision} />
          <span className="drag-badge">{drag.copy ? "Copy" : "Move"}</span>
        </div>
      )}
    </div>
  );
}
