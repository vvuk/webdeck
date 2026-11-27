# webdeck

A browser-based configurator for [OpenDeck](https://github.com/nekename/OpenDeck) decks: pick a connected deck, see its
keys and dials, click to edit, drag to rearrange, and drop images straight onto keys.

## Quick start

```sh
npm install
npm run dev          # http://localhost:5173 (API on :5174)
```

First run: click **Install bridge** in the banner (see "How it works" for why). That restarts OpenDeck once.

For an always-on setup: `npm run build && npm start`, then open http://localhost:5174.

## Using it

| Do this | To |
| --- | --- |
| Click a key or dial | Open the editor: action, key press/release code, title, colours, image |
| Drag a key onto another | Move it (swaps if the target is occupied) |
| <kbd>Ctrl</kbd>-drag (or <kbd>⌥</kbd>/<kbd>⌘</kbd>-drag) | Copy it, replacing the target |
| Drop an image file, or an image from another web page, on a key | Set that key's image (on an empty key, pick an action next) |
| **⏺ Record** next to a Simulate Input field | Press a shortcut to generate its token code |
| <kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd>, <kbd>Delete</kbd>, <kbd>Esc</kbd> | Undo / redo, clear the selected key, deselect |
| **Apply to OpenDeck** (<kbd>⌘S</kbd>) | Write the profile and restart OpenDeck |

Edits stay in the browser until you apply, so you can batch several changes into one restart.

## How it works (and why OpenDeck restarts)

The OpenAction API can't configure a deck. It's a *plugin* API: a plugin can only change settings, titles and images of
**its own** buttons, and it can't list devices, place actions or move keys. OpenDeck's configuration commands are
private Tauri IPC calls that only its own window can make. So webdeck works through the files:

```
browser (React) ──HTTP──► webdeck server (Node) ──► ~/Library/Application Support/opendeck/
                                │                     profiles/<device>/<profile>.json
                                │                     images/<device>/<profile>/<Keypad.N.0>/…
                                └─ quit OpenDeck → write files → relaunch OpenDeck
```

- **Writes need a restart.** OpenDeck reads each profile into memory once and never re-reads it while running, and
  would overwrite outside edits. Applying quits OpenDeck gracefully (it flushes pending saves on exit), writes, and
  relaunches it, which takes about a second. If OpenDeck isn't running, files are just written.
- **Conflicts are detected.** If the profile changed on disk since you loaded it (e.g. you edited in OpenDeck's own
  UI), applying stops and offers *Overwrite* or *Reload*.
- **The bridge** (`bridge/dev.webdeck.bridge.sdPlugin`) is a tiny, dependency-free OpenAction plugin. It's the one
  part that does use OpenAction: OpenDeck passes it the connected decks and their rows/columns, which the profile files
  don't record, and the bridge writes them to `devices.json` in its folder. It has no actions, so it doesn't show up
  in OpenDeck's action list. Without it, decks still load, but webdeck has to guess the column count (you can adjust it).
- **Images** you drop are fitted into a 288×288 PNG, as OpenDeck's own editor does (GIFs and SVGs are kept as-is),
  and saved as `<state>-user.<ext>` in the key's image folder. When keys move, swap or are copied, their image files
  move with them.
- Unknown fields in profile JSON are preserved, so saving an unchanged profile writes back identical bytes.

## Project layout

```
shared/types.ts           Profile format + API types (used by both sides)
server/
  app.ts                  HTTP routes, local-only request guard
  profiles.ts             read/write profiles, image file bookkeeping (moves/swaps/copies)
  plugins.ts              plugin manifests → actions, mirroring OpenDeck's own conversion
  opendeck-process.ts     detect/quit/launch OpenDeck (macOS, Linux, Windows)
  bridge.ts               install the bridge, read its devices.json
src/
  App.tsx                 state, loading/saving, shortcuts
  components/DeckView     the deck grid, pointer drag (move/copy), image drops
  components/Editor       action picker, appearance, behaviour
  components/SettingsForm native forms for known actions + raw JSON editor
  lib/action-forms.ts     ← add forms for more plugins here
  lib/profile-ops.ts      pure profile operations (undo = snapshot stack)
  lib/keystroke.ts        shortcut → enigo token syntax
bridge/                   the OpenAction helper plugin
```

`npm test` runs the unit tests (profile operations, and image moves against a temp config dir). `npm run typecheck`
checks both the app and the server.

### Supporting another plugin's settings

OpenDeck shows each plugin's own HTML "property inspector", but those talk to OpenDeck over its plugin socket and
can't be hosted here. webdeck has native forms for the OpenDeck Starter Pack actions. For any other action you get a
raw JSON editor. To add a form, add an entry to `ACTION_FORMS` in `src/lib/action-forms.ts`, keyed by action UUID, with
the plugin's settings keys (read them from its property inspector HTML in `opendeck/plugins/<plugin>/`).

## Configuration

| Env var | Default |
| --- | --- |
| `OPENDECK_CONFIG_DIR` | macOS `~/Library/Application Support/opendeck`, Linux `~/.config/opendeck`, Windows `%APPDATA%\opendeck` |
| `OPENDECK_FLATPAK=1` | use the Flatpak config path on Linux |
| `OPENDECK_COMMAND` | command to launch OpenDeck (default: `open -a OpenDeck` / `opendeck`) |
| `OPENDECK_LAUNCH_HIDDEN=0` | show OpenDeck's window after a restart (default: relaunch to the tray) |
| `WEBDECK_PORT` | API/production port, default `5174` |

The server binds to 127.0.0.1 only, rejects foreign `Host` headers, and requires an `X-Webdeck` header on writes, so
other websites can't use it to rewrite your config or restart OpenDeck.

## Limitations

- Multi-actions and toggle actions can be moved, copied and restyled, but their steps are edited in OpenDeck.
- Images that are built into the OpenDeck binary (`opendeck/…`) can't be previewed.
- Titles are previewed with your system fonts; OpenDeck renders them with its bundled fonts, so sizes may differ slightly.
- Applying restarts every OpenDeck plugin along with OpenDeck.
