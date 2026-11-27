import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express, { type NextFunction, type Request, type Response } from "express";

import type {
  ApiError,
  DeviceSummary,
  ProfileResponse,
  SaveProfileRequest,
  SaveProfileResponse,
  StatusResponse,
} from "../shared/types.ts";
import * as bridge from "./bridge.ts";
import { CONFIG_DIR, HttpError, paths, safeJoin } from "./config.ts";
import { fetchRemoteImage } from "./remote-image.ts";
import { isRunning, whileStopped } from "./opendeck-process.ts";
import { listActionCategories } from "./plugins.ts";
import { currentHash, getSelectedProfile, listDeviceIds, listProfiles, readProfile, writeProfile } from "./profiles.ts";

const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** Express 5 decodes params; profile ids can contain "/" so they arrive via a wildcard. */
const profileParam = (req: Request) => {
  const raw = req.params.profile as unknown;
  return Array.isArray(raw) ? raw.join("/") : String(raw);
};

export function createApp() {
  const app = express();

  // This server can rewrite your OpenDeck config and restart it, so only talk to our own page:
  // - reject foreign Host headers (DNS rebinding), and
  // - require a custom header on mutating requests, which cross-site pages can't send without a CORS preflight.
  app.use((req, res, next) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host) && host !== process.env.WEBDECK_HOST) {
      res.status(403).json({ error: "Forbidden host" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-webdeck"] !== "1") {
      res.status(403).json({ error: "Missing X-Webdeck header" });
      return;
    }
    next();
  });

  app.use(express.json({ limit: "64mb" }));

  app.get(
    "/api/status",
    asyncRoute(async (_req, res) => {
      const bridgeState = await bridge.readBridge();
      const running = await isRunning();
      const body: StatusResponse = {
        configDir: CONFIG_DIR,
        configDirExists: existsSync(CONFIG_DIR),
        openDeckRunning: running,
        bridgeInstalled: bridge.isInstalled(),
        bridgeActive: running && bridgeState.active,
        platform: process.platform,
      };
      res.json(body);
    }),
  );

  app.get(
    "/api/devices",
    asyncRoute(async (_req, res) => {
      const bridgeState = await bridge.readBridge();
      const running = await isRunning();
      const ids = new Set([...(await listDeviceIds()), ...Object.keys(bridgeState.devices)]);
      const devices: DeviceSummary[] = [];
      for (const id of ids) {
        const info = bridgeState.devices[id];
        devices.push({
          id,
          name: info?.name ?? id,
          rows: info?.rows ?? null,
          columns: info?.columns ?? null,
          type: info?.type ?? null,
          connected: Boolean(running && bridgeState.active && info?.connected),
          profiles: await listProfiles(id),
          selectedProfile: await getSelectedProfile(id),
        });
      }
      devices.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
      res.json(devices);
    }),
  );

  app.get(
    "/api/actions",
    asyncRoute(async (_req, res) => res.json(await listActionCategories())),
  );

  app.get(
    "/api/devices/:device/profiles/*profile",
    asyncRoute(async (req, res) => {
      const device = String(req.params.device);
      const profile = profileParam(req);
      const { data, hash } = await readProfile(device, profile);
      const body: ProfileResponse = { device, profile, data, hash };
      res.json(body);
    }),
  );

  app.put(
    "/api/devices/:device/profiles/*profile",
    asyncRoute(async (req, res) => {
      const device = String(req.params.device);
      const profile = profileParam(req);
      const body = req.body as SaveProfileRequest;
      if (!body?.data || !Array.isArray(body.data.keys)) throw new HttpError(400, "Missing profile data", "bad_request");

      const checkConflict = async (stage: string) => {
        if (!body.force && (await currentHash(device, profile)) !== body.baseHash) {
          throw new HttpError(409, `The profile was changed in OpenDeck ${stage}. Reload it, or save again to overwrite.`, "conflict");
        }
      };

      // Check once up front to avoid a pointless restart, and again after OpenDeck has flushed its pending saves.
      await checkConflict("since you loaded it");
      const result = await whileStopped(async (wasRunning) => {
        await checkConflict("before it shut down");
        const hash = await writeProfile(device, profile, body.data, Boolean(body.activate));
        return { hash, restarted: wasRunning };
      });
      const response: SaveProfileResponse = { ...result, data: body.data };
      res.json(response);
    }),
  );

  app.post(
    "/api/bridge/install",
    asyncRoute(async (_req, res) => {
      await whileStopped(async () => bridge.install());
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/restart",
    asyncRoute(async (_req, res) => {
      await whileStopped(async () => undefined);
      res.json({ ok: true });
    }),
  );

  /** Downloads an image dragged in from another web page (browsers usually only hand over its URL). */
  app.get(
    "/api/remote-image",
    asyncRoute(async (req, res) => {
      const { contentType, bytes } = await fetchRemoteImage(String(req.query.url ?? ""));
      res.type(contentType).send(bytes);
    }),
  );

  // Serve images and icons from the OpenDeck config directory (plugin icons, per-instance user images).
  app.get(
    "/files/*file",
    asyncRoute(async (req, res) => {
      const parts = req.params.file as unknown as string[];
      const file = safeJoin(CONFIG_DIR, ...parts);
      if (!file.startsWith(paths.plugins) && !file.startsWith(paths.images)) throw new HttpError(403, "Forbidden");
      if (!/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(file)) throw new HttpError(403, "Not an image");
      res.sendFile(file, { headers: { "Cache-Control": "no-cache" } }, (err) => {
        if (err && !res.headersSent) res.status(404).end();
      });
    }),
  );

  // In production, serve the built SPA.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*spa}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof HttpError ? error.status : 500;
    const body: ApiError = {
      error: error instanceof Error ? error.message : String(error),
      code: error instanceof HttpError ? error.code : "internal",
    };
    if (status >= 500) console.error(error);
    res.status(status).json(body);
  });

  return app;
}
