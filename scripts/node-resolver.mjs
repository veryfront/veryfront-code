// Custom Node.js ESM resolver for Deno-style imports
// This is a loader registration module that should be loaded with --import

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Register the custom loader hooks
register('./node-resolver-hooks.mjs', pathToFileURL(pathResolve(__dirname, '.')).href + '/');
