// Custom Node.js ESM loader for Deno-style import aliases
import { register } from 'node:module';

register('./resolver.mjs', import.meta.url);
