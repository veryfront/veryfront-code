/**
 * Browser polyfill for unknown Node.js built-in modules.
 *
 * Default imports receive an empty object. Named imports are deliberately absent,
 * so a browser-served module that depends on a Node.js API fails during module
 * instantiation instead of silently continuing with missing behavior.
 */
const nodeNoop = {};

export { nodeNoop as default };
