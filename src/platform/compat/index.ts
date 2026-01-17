// Core runtime compatibility modules
export * from "./crypto.ts";
export * from "./flags.ts";
export * from "./fs.ts";
export * from "./kv/index.ts";
export * from "./media-types.ts";
export * from "./process.ts";
export * from "./runtime.ts";
export * from "./stdin.ts";

// Path helper utilities (basic operations)
export * from "./path-helper.ts";

// NOTE: For http and path submodules, import directly:
// - import { ... } from "@veryfront/platform/compat/http/index.ts"
// - import { ... } from "@veryfront/platform/compat/path/index.ts"
// These are not re-exported to avoid name collisions with adapters module.
