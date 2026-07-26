/**
 * React workspace boundary for the browser-only Shiki highlighter.
 *
 * Core loads this facade lazily. The npm build maps it to the
 * consumer-installed `shiki` package.
 */
export * from "@veryfront/shiki-upstream";
