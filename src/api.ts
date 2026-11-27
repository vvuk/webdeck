import type {
  ActionCategory,
  ApiError,
  DeviceSummary,
  ProfileResponse,
  SaveProfileRequest,
  SaveProfileResponse,
  StatusResponse,
} from "../shared/types.ts";

export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: ApiError["code"],
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "X-Webdeck": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({ error: response.statusText }))) as ApiError;
    throw new RequestError(error.error, response.status, error.code);
  }
  return (await response.json()) as T;
}

const profileUrl = (device: string, profile: string) =>
  `/api/devices/${encodeURIComponent(device)}/profiles/${profile.split("/").map(encodeURIComponent).join("/")}`;

export const api = {
  status: () => request<StatusResponse>("GET", "/api/status"),
  devices: () => request<DeviceSummary[]>("GET", "/api/devices"),
  actions: () => request<ActionCategory[]>("GET", "/api/actions"),
  profile: (device: string, profile: string) => request<ProfileResponse>("GET", profileUrl(device, profile)),
  saveProfile: (device: string, profile: string, body: SaveProfileRequest) =>
    request<SaveProfileResponse>("PUT", profileUrl(device, profile), body),
  installBridge: () => request<{ ok: true }>("POST", "/api/bridge/install"),
  restart: () => request<{ ok: true }>("POST", "/api/restart"),
};
