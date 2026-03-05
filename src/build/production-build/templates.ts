/**
 * Embedded templates for production builds
 * These are embedded as strings to avoid file system dependencies in npm bundle
 * @module
 */

/**
 * Client-side CSS styles for error display in production builds
 */
export const CLIENT_STYLES = `.error-container {
  max-width: 600px;
  margin: 2rem auto;
  padding: 2rem;
  background: #fee;
  border: 1px solid #fcc;
  border-radius: 8px;
  color: #c00;
}`;

/**
 * Pre-bundled client router script for npm builds
 * Placeholder - this is auto-generated during build:npm
 */
export let CLIENT_ROUTER_BUNDLE: string | undefined;

export let CLIENT_PREFETCH_BUNDLE: string | undefined;
