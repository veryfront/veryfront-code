/****
 * Hydrate Script Generator
 * Generates client-side JavaScript for hydration
 */

/**
 * Hydration script that imports the RSC client and hydrates a project by slug.
 */
export function getHydrateScript(_slug: string): string {
  return `
// Veryfront hydration compatibility script
// Legacy full-document HTML still loads /_veryfront/hydrate.js. The
// modern RSC client auto-boots on import, so this shim only preserves the
// old URL without depending on a removed "hydrate" export.
import '/_veryfront/rsc/client.js';
    `.trim();
}
