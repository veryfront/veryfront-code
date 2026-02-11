/**
 * Component overrides for `.mdx` page rendering.
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
 */

// veryfront/mdx — MDX provider and component overrides
//
// For customizing how .mdx pages render components.
// For runtime markdown string rendering, use veryfront/markdown instead.

export { MDXProvider, useMDXComponents } from "#veryfront/react/components/MDXProvider.tsx";
export type { MDXProviderProps } from "#veryfront/react/components/MDXProvider.tsx";
