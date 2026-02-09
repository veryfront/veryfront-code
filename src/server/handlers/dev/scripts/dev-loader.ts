/****
 * Dev Loader and Hydrate Script Generators
 * Generates client-side JavaScript for development bootstrapping and hydration
 */

/**
 * Dev loader script that bootstraps development mode:
 * loads the HMR runtime (if enabled) and the error overlay.
 */
export function getDevLoader(): string {
  return `
// Veryfront Dev Loader
console.log('[Veryfront] Development mode active');

// Load HMR if enabled
if (window.__HMR_ENABLED__) {
  const script = document.createElement('script');
  script.src = '/_veryfront/hmr-runtime.js';
  document.head.appendChild(script);
}

// Load error overlay
const errorScript = document.createElement('script');
errorScript.src = '/_veryfront/error-overlay.js';
document.head.appendChild(errorScript);
    `.trim();
}

/**
 * Hydration script that imports the RSC client and hydrates a project by slug.
 */
export function getHydrateScript(slug: string): string {
  return `
// Veryfront Hydration Script
import { hydrate } from '/_veryfront/rsc/client.js';
hydrate('${slug}', {
  ssr: true
});
    `.trim();
}
