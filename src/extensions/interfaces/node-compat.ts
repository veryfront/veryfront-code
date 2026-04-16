/**
 * Contract interface for Node.js compatibility shims.
 *
 * Default implementation: `@veryfront/ext-node-compat`
 *
 * @module extensions/interfaces/node-compat
 */

/**
 * NodeCompat contract interface.
 *
 * Implementations provide access to Node.js-compatible APIs in
 * environments where native Node modules are unavailable (e.g. Deno).
 *
 * Each getter returns the module's namespace object, matching the
 * shape of the corresponding Node.js built-in.
 */
export interface NodeCompat {
  /** Return a Node-compatible `fs` module (sync + async + promises). */
  getFS(): unknown;
  /** Return a Node-compatible `path` module. */
  getPath(): unknown;
  /** Return a Node-compatible `WebSocket` constructor. */
  getWebSocket(): unknown;
}
