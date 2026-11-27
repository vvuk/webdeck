import { useEffect, useRef } from "react";

import type { ActionInstance } from "../../shared/types.ts";
import { imageUrl } from "../lib/images.ts";
import { displayTitle } from "../lib/profile-ops.ts";

const SIZE = 144; // OpenDeck renders keys on a 144px canvas; we match it so font sizes look the same.

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(src: string): Promise<HTMLImageElement | null> {
  let cached = imageCache.get(src);
  if (!cached) {
    cached = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    imageCache.set(src, cached);
    if (imageCache.size > 500) imageCache.delete(imageCache.keys().next().value!);
  }
  return cached;
}

interface Props {
  instance: ActionInstance;
  stateIndex?: number;
  device: string;
  profile: string;
  revision: number;
}

/** Draws a key the way OpenDeck does (rendererHelper.ts): background, image scaled from the centre, stroked title. */
export function KeyFace({ instance, stateIndex, device, profile, revision }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const index = stateIndex ?? instance.current_state;
  const state = instance.states[index] ?? instance.states[0];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx || !state) return;

      const candidates = [
        state.image_override,
        state.image,
        instance.action.states[index]?.image,
        instance.action.icon,
      ].map((v) => imageUrl(v, instance, device, profile, revision));
      let img: HTMLImageElement | null = null;
      for (const src of candidates) {
        if (src && (img = await loadImage(src))) break;
      }
      if (cancelled) return;

      ctx.clearRect(0, 0, SIZE, SIZE);
      if (state.background_colour && !state.background_colour.startsWith("#000000")) {
        ctx.fillStyle = state.background_colour;
        ctx.fillRect(0, 0, SIZE, SIZE);
      }
      if (img) {
        const scale = Math.max(10, state.image_scale || 100) / 100;
        const s = SIZE * scale;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, (SIZE - s) / 2, (SIZE - s) / 2, s, s);
      }

      const title = displayTitle(state);
      if (state.show && title) {
        const size = state.size * 2;
        const lines = title.split("\n");
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.font = `${state.style.includes("Bold") ? "bold " : ""}${state.style.includes("Italic") ? "italic " : ""}${size}px "${state.family}", system-ui, sans-serif`;
        ctx.fillStyle = state.colour;
        ctx.strokeStyle = state.stroke_colour;
        ctx.lineWidth = state.stroke_size;
        ctx.lineJoin = "round";
        let y = SIZE / 2 - size * lines.length * 0.5;
        if (state.alignment === "top") y = ctx.lineWidth;
        if (state.alignment === "bottom") y = SIZE - size * lines.length - ctx.lineWidth;
        lines.forEach((line, i) => {
          const ly = y + size * i;
          if (state.stroke_size > 0) ctx.strokeText(line, SIZE / 2, ly);
          ctx.fillText(line, SIZE / 2, ly);
          if (state.underline) {
            const w = ctx.measureText(line).width;
            ctx.fillRect(SIZE / 2 - w / 2, ly + size + 4, w, 3);
          }
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [instance, state, index, device, profile, revision]);

  return <canvas ref={canvas} width={SIZE} height={SIZE} className="key-face" />;
}
