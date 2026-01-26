import { HMR_CLIENT_RELOAD_DELAY_MS } from "../../../utils/index.js";
import { generateHMRClientTemplate } from "./templates.js";
export function generateHMRRuntimeScript(options) {
    const clientCode = generateHMRClientTemplate(options.port, "127.0.0.1", HMR_CLIENT_RELOAD_DELAY_MS);
    return `// Veryfront HMR Runtime (Generated)
(function() {
  ${clientCode}
})();`;
}
