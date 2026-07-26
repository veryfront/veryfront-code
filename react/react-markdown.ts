/**
 * React workspace boundary for the upstream Markdown renderer.
 *
 * Core source imports this local facade so the root dependency boundary stays
 * third-party free. The npm build maps this file to the consumer-installed
 * `react-markdown` package instead of bundling the esm.sh graph.
 */
export { default } from "@veryfront/react-markdown-upstream";
export type {
  Components,
  ExtraProps,
  Options,
  UrlTransform,
} from "@veryfront/react-markdown-upstream";
