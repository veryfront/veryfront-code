// Consumer fixture — documented `veryfront/mdx` provider composition.
//
// Never executed. The consumer `tsc --noEmit` gate compiles this file against
// the built npm declarations exactly as an external React application does.
import * as React from "react";
import {
  MDXProvider,
  type MDXProviderProps,
  useMDXComponents,
} from "veryfront/mdx";

function Heading({ children }: React.ComponentProps<"h1">): React.ReactElement {
  return <h1 className="docs-heading">{children}</h1>;
}

function Link(props: React.ComponentProps<"a">): React.ReactElement {
  return <a {...props} rel="noreferrer" />;
}

function InlineCode({ children }: React.ComponentProps<"code">): React.ReactElement {
  return <code className="inline-code">{children}</code>;
}

const providerProps = {
  components: Object.freeze({ h1: Heading, a: Link }),
  children: null,
} satisfies MDXProviderProps;

function CurrentOverrides(): React.ReactElement {
  const components = useMDXComponents({ code: InlineCode });
  const Code = components.code ?? "code";
  return <Code>const ready = true;</Code>;
}

/** Nested providers inherit outer overrides and apply the nearest override. */
export function MdxCompositionDemo(): React.ReactElement {
  return (
    <MDXProvider {...providerProps}>
      <MDXProvider components={{ h1: Heading }}>
        <CurrentOverrides />
      </MDXProvider>
    </MDXProvider>
  );
}
