// Starting and stopping the OpenDeck desktop app.
//
// OpenDeck keeps profiles in memory and never re-reads them from disk while running, so any change we write has to
// happen while it is stopped. `whileStopped` wraps that: quit (OpenDeck flushes pending saves on a clean exit), run the
// callback, relaunch.

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const PROCESS_NAME = process.env.OPENDECK_PROCESS_NAME ?? (process.platform === "win32" ? "opendeck.exe" : "opendeck");
/** Launch hidden (tray only) by default; set OPENDECK_LAUNCH_HIDDEN=0 to show the window on relaunch. */
const LAUNCH_HIDDEN = process.env.OPENDECK_LAUNCH_HIDDEN !== "0";

export async function isRunning(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await exec("tasklist", ["/FI", `IMAGENAME eq ${PROCESS_NAME}`, "/NH"]);
      return stdout.toLowerCase().includes(PROCESS_NAME.toLowerCase());
    }
    await exec("pgrep", ["-x", PROCESS_NAME]);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return predicate();
}

const stopped = async () => !(await isRunning());

/** Ask OpenDeck to quit gracefully, escalating to signals if it doesn't. Resolves once the process is gone. */
export async function quit(): Promise<void> {
  if (!(await isRunning())) return;

  try {
    if (process.platform === "darwin") {
      await exec("osascript", ["-e", 'tell application "OpenDeck" to quit']);
    } else if (process.platform === "win32") {
      await exec("taskkill", ["/IM", PROCESS_NAME]);
    } else {
      await exec("pkill", ["-TERM", "-x", PROCESS_NAME]);
    }
  } catch {
    // Fall through to the escalation below.
  }
  if (await waitUntil(stopped, 8000)) return;

  // Graceful quit didn't work; a hard stop loses only edits made in OpenDeck's UI in the last moment.
  try {
    if (process.platform === "win32") await exec("taskkill", ["/F", "/IM", PROCESS_NAME]);
    else await exec("pkill", ["-KILL", "-x", PROCESS_NAME]);
  } catch {
    // ignore
  }
  if (!(await waitUntil(stopped, 4000))) {
    throw new Error("OpenDeck did not exit; changes were not written");
  }
}

export async function launch(): Promise<void> {
  const hideArgs = LAUNCH_HIDDEN ? ["--hide"] : [];
  const custom = process.env.OPENDECK_COMMAND;

  if (custom) {
    spawn(custom, hideArgs, { detached: true, stdio: "ignore", shell: true }).unref();
  } else if (process.platform === "darwin") {
    await exec("open", ["-g", "-a", "OpenDeck", ...(hideArgs.length ? ["--args", ...hideArgs] : [])]);
  } else if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", "opendeck", ...hideArgs], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("opendeck", hideArgs, { detached: true, stdio: "ignore" }).unref();
  }

  await waitUntil(isRunning, 10000);
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` with OpenDeck stopped, restarting it afterwards if it was running before. Calls are serialised so two saves
 * can't interleave their quit/launch cycles. `fn` receives whether OpenDeck had been running.
 */
export function whileStopped<T>(fn: (wasRunning: boolean) => Promise<T>): Promise<T> {
  const run = async () => {
    const wasRunning = await isRunning();
    if (wasRunning) await quit();
    try {
      return await fn(wasRunning);
    } finally {
      if (wasRunning) await launch();
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
