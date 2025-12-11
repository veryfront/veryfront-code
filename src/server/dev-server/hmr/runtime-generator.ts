
import { HMR_CLIENT_RELOAD_DELAY_MS } from "@veryfront/utils";
import { generateHMRClientTemplate } from "./templates.ts";

export interface HMRRuntimeOptions {
  port: number;
  reactRefresh?: boolean;
}

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
