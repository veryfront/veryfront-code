// Custom Node.js ESM resolver for Deno-style imports
// This is a loader registration module that should be loaded with --import

import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Register the custom loader hooks
const { registerHooks } = await import("node:module");
if (process.features.typescript === "transform" && typeof registerHooks === "function") {
  const { resolve, loadSync } = await import("./resolver-hooks.mjs");
  registerHooks({ resolve, load: loadSync });
} else {
  register("./resolver-hooks.mjs", pathToFileURL(pathResolve(__dirname, ".")).href + "/");
}
