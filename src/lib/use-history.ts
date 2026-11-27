import { useCallback, useReducer } from "react";

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
  /** The snapshot last loaded from / saved to disk, for the "unsaved changes" indicator. */
  saved: T;
  /** Key and time of the last change, so bursts of edits to one field (typing) become a single undo step. */
  last: { key: string; at: number } | null;
}

type HistoryAction<T> =
  | { type: "reset"; value: T }
  | { type: "change"; update: (value: T) => T; coalesce?: string; at: number }
  | { type: "undo" }
  | { type: "redo" };

const LIMIT = 200;
const COALESCE_MS = 1000;

function reducer<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
  switch (action.type) {
    case "reset":
      return { past: [], present: action.value, future: [], saved: action.value, last: null };
    case "change": {
      const next = action.update(state.present);
      if (next === state.present) return state;
      const last = action.coalesce ? { key: action.coalesce, at: action.at } : null;
      const merge = last && state.last?.key === last.key && last.at - state.last.at < COALESCE_MS && state.past.length > 0;
      if (merge) return { ...state, present: next, future: [], last };
      return { ...state, past: [...state.past.slice(-LIMIT), state.present], present: next, future: [], last };
    }
    case "undo":
      if (!state.past.length) return state;
      return { ...state, past: state.past.slice(0, -1), present: state.past.at(-1)!, future: [state.present, ...state.future], last: null };
    case "redo":
      if (!state.future.length) return state;
      return { ...state, past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1), last: null };
  }
}

/** Undoable state with a notion of "saved". Updates are pure functions of the previous value. */
export function useHistory<T>(initial: T) {
  const [state, dispatch] = useReducer(reducer<T>, { past: [], present: initial, future: [], saved: initial, last: null });
  return {
    value: state.present,
    dirty: state.present !== state.saved,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    /** Apply a change. Pass `coalesce` (e.g. a field id) to merge rapid repeated edits into one undo step. */
    change: useCallback(
      (update: (value: T) => T, coalesce?: string) => dispatch({ type: "change", update, coalesce, at: Date.now() }),
      [],
    ),
    reset: useCallback((value: T) => dispatch({ type: "reset", value }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
  };
}
