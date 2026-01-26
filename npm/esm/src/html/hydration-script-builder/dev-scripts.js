import { generateDevErrorLoggerScript } from "./dev-error-logger.js";
import { generateDevComponentManifestScript } from "./dev-component-manifest.js";
import { generateDevClientRendererScript } from "./dev-client-renderer.js";
function generateHMRScript(config, nonce, skipDevHMR) {
    // Skip dev HMR script when preview-hmr.js will be used instead
    if (skipDevHMR || !config.dev?.hmr)
        return "";
    const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
    return `<script type="module" src="/_veryfront/hmr.js"${nonceAttr}></script>`;
}
export function getDevScripts(_slug, config, _params, _props, nonce, options) {
    const scripts = [];
    // Error logger only works in local dev (endpoint returns 404 in preview/prod)
    if (!options?.skipErrorLogger) {
        scripts.push(generateDevErrorLoggerScript(nonce));
    }
    scripts.push(generateDevComponentManifestScript(config, nonce));
    scripts.push(generateDevClientRendererScript(nonce));
    scripts.push(generateHMRScript(config, nonce, options?.skipDevHMR));
    return scripts.join("\n");
}
