// Types describing OpenDeck's on-disk profile format and the webdeck HTTP API.
//
// The profile types mirror OpenDeck's `DiskProfile` / `DiskActionInstance` (src-tauri/src/store/simplified_profile.rs).
// They are intentionally loose (index signatures) so that fields we don't know about survive a round trip unchanged.

export type Controller = "Keypad" | "Encoder" | (string & {});

export interface ActionState {
  image: string;
  /** Image set by the user (file name relative to the instance's image dir, a config-relative path, or a data URL). */
  image_override: string | null;
  image_scale: number;
  background_colour: string;
  name: string;
  /** Title provided by the plugin/manifest. */
  text: string;
  /** Title set by the user; wins over `text` when non-empty. */
  text_override: string | null;
  show: boolean;
  colour: string;
  stroke_colour: string;
  alignment: "top" | "middle" | "bottom";
  family: string;
  style: string;
  size: number;
  stroke_size: number;
  underline: boolean;
  [extra: string]: unknown;
}

export interface Action {
  name: string;
  uuid: string;
  plugin: string;
  tooltip: string;
  icon: string;
  disable_automatic_states: boolean;
  visible_in_action_list: boolean;
  supported_in_multi_actions: boolean;
  property_inspector: string;
  controllers: Controller[];
  encoder: unknown;
  states: ActionState[];
  [extra: string]: unknown;
}

export interface ActionInstance {
  action: Action;
  /** "<Controller>.<position>.<index>", e.g. "Keypad.3.0". Children of multi-actions have index >= 1. */
  context: string;
  states: ActionState[];
  current_state: number;
  settings: Record<string, unknown>;
  children: ActionInstance[] | null;
  /**
   * webdeck-only bookkeeping: the context this instance was loaded from, i.e. the directory its numbered image files
   * live in. Lets the server carry images along when an instance is moved or copied; null for a brand-new instance
   * (its slot's old image directory is cleared). Stripped before writing to disk.
   */
  __origin?: string | null;
  [extra: string]: unknown;
}

export type Slot = ActionInstance | null;

export interface Profile {
  keys: Slot[];
  sliders: Slot[];
  infobars?: Slot[];
  [extra: string]: unknown;
}

export interface DeviceSummary {
  id: string;
  name: string;
  /** Rows/columns of the key grid; null when unknown (no bridge data yet). */
  rows: number | null;
  columns: number | null;
  type: number | null;
  connected: boolean;
  profiles: string[];
  selectedProfile: string | null;
}

export interface StatusResponse {
  configDir: string;
  configDirExists: boolean;
  openDeckRunning: boolean;
  bridgeInstalled: boolean;
  bridgeActive: boolean;
  platform: string;
}

export interface ProfileResponse {
  device: string;
  profile: string;
  data: Profile;
  /** Hash of the profile file as read; sent back on save to detect concurrent edits. */
  hash: string;
}

export interface SaveProfileRequest {
  data: Profile;
  baseHash: string;
  /** Overwrite even if the file changed on disk since it was loaded. */
  force?: boolean;
  /** Also make this the active profile for the device. */
  activate?: boolean;
}

export interface SaveProfileResponse {
  hash: string;
  restarted: boolean;
  data: Profile;
}

export interface ActionCategory {
  name: string;
  plugin: string;
  actions: Action[];
}

export interface ApiError {
  error: string;
  code?: "conflict" | "not_found" | "bad_request" | "internal";
}
