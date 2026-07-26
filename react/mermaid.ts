/**
 * React workspace boundary for the browser-only Mermaid renderer.
 *
 * Core loads this facade lazily. The npm build maps it to the
 * consumer-installed `mermaid` package.
 */
export { default } from "@veryfront/mermaid-upstream";
