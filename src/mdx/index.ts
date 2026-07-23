/**
 * Component overrides for `.mdx` page rendering.
 *
 * @module mdx
 *
 * @example
 * ```tsx
 * import type { ComponentProps } from "react";
 * import { MDXProvider, useMDXComponents } from "veryfront/mdx";
 *
 * function ArticleHeading(props: ComponentProps<"h1">) {
 *   return <h1 className="article-heading" {...props} />;
 * }
 *
 * function ArticleContent() {
 *   const { h1: Heading = "h1" } = useMDXComponents();
 *   return <Heading>Hello from MDX</Heading>;
 * }
 *
 * export default function Article() {
 *   return (
 *     <MDXProvider components={{ h1: ArticleHeading }}>
 *       <ArticleContent />
 *     </MDXProvider>
 *   );
 * }
 * ```
 *
 * Nested providers inherit outer overrides. Inner providers and local hook
 * overrides take precedence.
 *
 * For runtime markdown string rendering, use `veryfront/markdown` instead.
 */
export {
  type MDXComponents,
  MDXProvider,
  type MDXProviderProps,
  useMDXComponents,
} from "#veryfront/react/components/MDXProvider.tsx";
