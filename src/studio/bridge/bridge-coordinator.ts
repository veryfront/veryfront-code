/**
 * Bridge Coordinator
 *
 * Entry point for the studio bridge ESM modules.
 * Reads config from window.__VF_BRIDGE_CONFIG__, initializes all modules,
 * and exposes debug internals when configured.
 */

import { getConfig, initConfig } from "./bridge-config.ts";
import { extractRawBlocksForEditor, parseMdxImportMap } from "./bridge-markdown-core.ts";
import { getMdxBlockOpenUiState } from "./bridge-block-drag.ts";
import { replaceYTextContent, writeToYText } from "./bridge-markdown-yjs.ts";
import { init } from "./bridge-init.ts";

// Initialize config from the global injected by the server
initConfig();

const config = getConfig();

// Expose debug internals when configured
if (config.debugExposeInternals && typeof window !== "undefined") {
  // deno-lint-ignore no-explicit-any -- exposing debug internals on window global
  (window as any).__VF_STUDIO_BRIDGE_DEBUG = {
    parseMdxImportMap: parseMdxImportMap,
    extractRawBlocksForEditor: extractRawBlocksForEditor,
    getMdxBlockOpenUiState: getMdxBlockOpenUiState,
    writeToYText: writeToYText,
    replaceYTextContent: replaceYTextContent,
  };
}

// Run init unless debug skip is set
if (!config.debugSkipInit) {
  init();
}
