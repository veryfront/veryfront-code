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
 *
 * For runtime markdown string rendering, use `veryfront/markdown` instead.
 */
export {
  MDXProvider,
  type MDXProviderProps,
  useMDXComponents,
} from "#veryfront/react/components/MDXProvider.tsx";
