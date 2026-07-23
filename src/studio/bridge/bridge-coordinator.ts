/**
 * Bridge Coordinator
 *
 * Entry point for the studio bridge ESM modules.
 * Reads config from window.__VF_BRIDGE_CONFIG__ and initializes all modules.
 */

import { initConfig } from "./bridge-config.ts";
import { init } from "./bridge-init.ts";

// Initialize config from the global injected by the server
initConfig();
init();
