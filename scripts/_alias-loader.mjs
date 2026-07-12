import { register } from "node:module";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const hooksPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "_alias-hooks.mjs");
register(pathToFileURL(hooksPath).href, import.meta.url);
