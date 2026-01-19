/**
 * Portable @std/* shims for Node.js and Bun.
 *
 * This module provides compatibility shims for Deno's @std/* standard library
 * to work in Node.js and Bun environments.
 *
 * @module
 */

// Re-export all modules
export * as expect from "./expect.ts";
export * as fs from "./fs.ts";
export * as path from "./path.ts";
export * as async from "./async.ts";
export * as flags from "./flags.ts";
export * as dotenv from "./dotenv.ts";
export * as fmtColors from "./fmt-colors.ts";
export * as frontMatterYaml from "./front-matter-yaml.ts";
