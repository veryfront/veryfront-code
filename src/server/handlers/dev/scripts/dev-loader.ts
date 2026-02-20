/****
 * Hydrate Script Generator
 * Generates client-side JavaScript for hydration
 */

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
