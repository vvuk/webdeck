import { install } from "../bridge.ts";
import { paths } from "../config.ts";

await install();
console.log(`Installed webdeck bridge into ${paths.plugins}. Restart OpenDeck to load it.`);
