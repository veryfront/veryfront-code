/**
 * HMR Runtime Generator
 * Orchestrates the generation of HMR runtime script
 */

import { HMR_CLIENT_RELOAD_DELAY_MS } from "@veryfront/utils";
import { generateHMRClientTemplate } from "./templates.ts";

/**
 * Options for generating HMR runtime script
 */
export interface HMRRuntimeOptions {
  port: number;
  reactRefresh?: boolean;
}

/**
 * Generate the HMR runtime script that runs in the browser
 * This script establishes WebSocket connection and handles updates
 *
 * @param options - Configuration for the runtime script
 * @returns Generated JavaScript code as a string
 */
export function generateHMRRuntimeScript(options: HMRRuntimeOptions): string {
  const clientCode = generateHMRClientTemplate(
    options.port,
    "127.0.0.1",
    HMR_CLIENT_RELOAD_DELAY_MS,
  );

  return `// Veryfront HMR Runtime (Generated)
(function() {
  ${clientCode}
})();`;
}
