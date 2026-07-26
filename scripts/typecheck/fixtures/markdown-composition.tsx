// Consumer fixture — documented `veryfront/markdown` composition.
//
// Never executed. The consumer `tsc --noEmit` gate compiles this file against
// the built npm declarations, including react-markdown's transitive public
// types, exactly as an external React application does.
import * as React from "react";
import { Markdown, type MarkdownProps } from "veryfront/markdown";

const frozenPlugins = Object.freeze([]);

const markdownProps: MarkdownProps = {
  children: "# Result\n\n| Check | Result |\n| --- | --- |\n| Tests | Passed |",
  remarkPlugins: frozenPlugins,
  rehypePlugins: frozenPlugins,
  components: {
    a: ({ href, children }) => <a href={href}>{children}</a>,
  },
  renderCodeBlock: ({ language, code }) => (
    <pre data-language={language}>
      <code>{code}</code>
    </pre>
  ),
};

/** Standalone SSR-compatible Markdown surface with consumer overrides. */
export function MarkdownDemo(): React.ReactElement {
  return <Markdown {...markdownProps} />;
}
