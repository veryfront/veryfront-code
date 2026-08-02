/**
 * Composable component overrides for compiled `.mdx` page rendering.
 *
 * @module mdx
 *
 * @example
 * ```tsx
 * import { MDXProvider } from "veryfront/mdx";
 *
 * <MDXProvider components={{ h1: CustomH1, code: CustomCode, a: CustomLink }}>
 *   {children}
 * </MDXProvider>
 * ```
 *
 * Nested providers inherit outer entries, with the nearest override taking
 * precedence. Component maps are application-owned React code; this module
 * does not compile or sanitize arbitrary MDX source.
 *
 * For runtime markdown string rendering, use `veryfront/markdown` instead.
 */
export {
  MDXProvider,
  type MDXProviderProps,
  useMDXComponents,
} from "#veryfront/react/components/MDXProvider.tsx";
