// webdeck bridge: a minimal OpenAction plugin that records which decks OpenDeck has connected, and their geometry,
// into devices.json next to this file. The webdeck server reads that file.
//
// OpenDeck runs this with: node bridge.mjs -port <p> -pluginUUID <uuid> -registerEvent <event> -info <json>
// Requires Node.js 22+ (global WebSocket).

import { writeFileSync, renameSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "devices.json");

const args = {};
for (let i = 2; i < process.argv.length - 1; i += 2) args[process.argv[i].replace(/^-+/, "")] = process.argv[i + 1];

/** id -> { id, name, rows, columns, type, connected, lastSeen } (kept across runs so offline decks keep their size) */
const devices = {};
try {
  Object.assign(devices, JSON.parse(readFileSync(outFile, "utf8")).devices ?? {});
} catch {}
for (const d of Object.values(devices)) d.connected = false;

function save(active) {
  const tmp = outFile + ".tmp";
  writeFileSync(tmp, JSON.stringify({ active, pid: process.pid, updatedAt: new Date().toISOString(), devices }, null, 2));
  renameSync(tmp, outFile);
}

function upsert(info, id = info.id) {
  devices[id] = {
    id,
    name: info.name ?? id,
    rows: info.size?.rows ?? null,
    columns: info.size?.columns ?? null,
    type: info.type ?? null,
    connected: true,
    lastSeen: new Date().toISOString(),
  };
}

try {
  for (const d of JSON.parse(args.info ?? "{}").devices ?? []) upsert(d);
} catch (e) {
  console.error("Could not parse -info:", e);
}
save(true);

if (typeof WebSocket === "undefined") {
  console.error("webdeck bridge needs Node.js 22+ (global WebSocket). Device list updates disabled.");
} else {
  const ws = new WebSocket(`ws://127.0.0.1:${args.port}`);
  ws.addEventListener("open", () => ws.send(JSON.stringify({ event: args.registerEvent, uuid: args.pluginUUID })));
  ws.addEventListener("message", (msg) => {
    let event;
    try {
      event = JSON.parse(msg.data);
    } catch {
      return;
    }
    if (event.event === "deviceDidConnect") {
      upsert(event.deviceInfo ?? {}, event.device);
      save(true);
    } else if (event.event === "deviceDidDisconnect" && devices[event.device]) {
      devices[event.device].connected = false;
      save(true);
    }
  });
  ws.addEventListener("close", () => {
    for (const d of Object.values(devices)) d.connected = false;
    save(false);
    process.exit(0);
  });
  ws.addEventListener("error", (e) => console.error("socket error", e.message ?? e));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const d of Object.values(devices)) d.connected = false;
    save(false);
    process.exit(0);
  });
}
