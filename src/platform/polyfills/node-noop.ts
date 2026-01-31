/**
 * Browser polyfill for unknown Node.js built-in modules.
 *
 * Exports an empty object. If a server-only Node built-in leaks into
 * a browser-served module, this prevents the import from crashing.
 * Any actual usage of the imported API will fail at call-site, which
 * surfaces the problem clearly instead of a cryptic module resolution error.
 */
export default {};
