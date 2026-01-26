import type { ImportMapConfig } from "./types.js";
/**
 * Get React import map for SSR in Deno.
 * Uses npm: specifiers which Deno handles natively with automatic deduplication.
 * See: https://deno.com/blog/not-using-npm-specifiers-doing-it-wrong
 *
 * This replaces the previous shared-*.ts approach which required manual re-exports.
 */
export declare function getDenoReactImportMap(): Record<string, string>;
/**
 * Get the default import map for SSR transforms.
 *
 * For Deno SSR: Uses npm: specifiers with automatic deduplication.
 * For other runtimes: Uses esm.sh URLs with external=react.
 */
export declare function getDefaultImportMap(): ImportMapConfig;
//# sourceMappingURL=default-import-map.d.ts.map