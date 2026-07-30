// Consumer fixture — documented `veryfront/markdown` composition.
//
// Never executed. The consumer `tsc --noEmit` gate compiles this file against
// the built npm declarations and verifies the dependency-free renderer
// capability contract exactly as an external React application does.
import * as React from "react";
import {
  Markdown,
  type MarkdownProps,
  type MarkdownRendererProps,
  MarkdownRendererProvider,
} from "veryfront/markdown";

function RichRenderer({
  source,
  components,
}: MarkdownRendererProps): React.ReactElement {
  const Link = components?.a;
  return Link
    ? <Link href="/result">{source}</Link>
    : <article>{source}</article>;
}

const markdownProps: MarkdownProps = {
  children: "# Result\n\n| Check | Result |\n| --- | --- |\n| Tests | Passed |",
  components: {
    a: ({ href, children }) => <a href={href}>{children}</a>,
  },
};

/** SSR-compatible Markdown surface with an explicit extension renderer. */
export function MarkdownDemo(): React.ReactElement {
  return (
    <MarkdownRendererProvider renderer={RichRenderer}>
      <Markdown {...markdownProps} />
    </MarkdownRendererProvider>
  );
}
