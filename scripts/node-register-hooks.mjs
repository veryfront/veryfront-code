/**
 * Node.js module registration for TypeScript/TSX hooks.
 * Uses the modern register() API (Node 20.6+).
 *
 * Usage: node --import ./scripts/node-register-hooks.mjs your-script.ts
 */

import { register } from 'node:module';

// Register our resolver hooks
// The second argument must be a URL string, not a URL object
register('./node-resolver-hooks.mjs', import.meta.url);
