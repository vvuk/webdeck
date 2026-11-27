import { createApp } from "./app.ts";
import { CONFIG_DIR, HOST, PORT } from "./config.ts";

createApp().listen(PORT, HOST, () => {
  console.log(`webdeck server on http://${HOST}:${PORT}  (OpenDeck config: ${CONFIG_DIR})`);
});
