import "#veryfront/schemas/_test-setup.ts";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as mdxModule from "./index.ts";
import * as publicMdxModule from "veryfront/mdx";
import * as mdxProviderModule from "#veryfront/react/components/MDXProvider.tsx";
import type { MDXProviderProps as BarrelMDXProviderProps } from "./index.ts";
import type { MDXComponents, MDXProviderProps as PublicMDXProviderProps } from "veryfront/mdx";
import type { MDXProviderProps as SourceMDXProviderProps } from "#veryfront/react/components/MDXProvider.tsx";

const expectedRuntimeExports = ["MDXProvider", "useMDXComponents"];
const sampleProps = { children: null } satisfies SourceMDXProviderProps;
const barrelProps: BarrelMDXProviderProps = sampleProps;
const publicProps: PublicMDXProviderProps = sampleProps;
const publicComponents: MDXComponents = { h1: "h2" };

void barrelProps;
void publicProps;
void publicComponents;

function CaptureComponents(
  { onCapture, overrides }: {
    onCapture: (components: MDXComponents) => void;
    overrides?: MDXComponents;
  },
): React.ReactElement {
  onCapture(mdxModule.useMDXComponents(overrides));
  return React.createElement("span", null, "captured");
}

describe("mdx/index.ts exports", () => {
  it("preserves the runtime export surface for veryfront/mdx", () => {
    assertEquals(Object.keys(mdxModule).sort(), expectedRuntimeExports);
  });

  it("keeps the runtime re-exports wired to the source provider module", () => {
    assertStrictEquals(mdxModule.MDXProvider, mdxProviderModule.MDXProvider);
    assertStrictEquals(mdxModule.useMDXComponents, mdxProviderModule.useMDXComponents);
  });

  it("keeps the documented veryfront/mdx entrypoint aligned with the barrel module", () => {
    assertEquals(Object.keys(publicMdxModule).sort(), expectedRuntimeExports);
    assertStrictEquals(publicMdxModule.MDXProvider, mdxModule.MDXProvider);
    assertStrictEquals(publicMdxModule.useMDXComponents, mdxModule.useMDXComponents);
  });

  it("merges nested provider overrides", () => {
    const Heading = (): React.ReactElement => React.createElement("h1", null, "heading");
    const Code = (): React.ReactElement => React.createElement("code", null, "code");
    let captured: MDXComponents | undefined;

    renderToString(
      React.createElement(
        mdxModule.MDXProvider,
        { components: { h1: Heading } },
        React.createElement(
          mdxModule.MDXProvider,
          { components: { code: Code } },
          React.createElement(CaptureComponents, {
            onCapture: (components) => captured = components,
          }),
        ),
      ),
    );

    assertStrictEquals(captured?.h1, Heading);
    assertStrictEquals(captured?.code, Code);
  });

  it("gives an inner provider precedence for the same component name", () => {
    const OuterHeading = (): React.ReactElement => React.createElement("h1", null, "outer");
    const InnerHeading = (): React.ReactElement => React.createElement("h1", null, "inner");
    let captured: MDXComponents | undefined;

    renderToString(
      React.createElement(
        mdxModule.MDXProvider,
        { components: { h1: OuterHeading } },
        React.createElement(
          mdxModule.MDXProvider,
          { components: { h1: InnerHeading } },
          React.createElement(CaptureComponents, {
            onCapture: (components) => captured = components,
          }),
        ),
      ),
    );

    assertStrictEquals(captured?.h1, InnerHeading);
  });

  it("inherits an outer provider when a nested provider has no overrides", () => {
    const Heading = (): React.ReactElement => React.createElement("h1", null, "heading");
    let captured: MDXComponents | undefined;

    renderToString(
      React.createElement(
        mdxModule.MDXProvider,
        { components: { h1: Heading } },
        React.createElement(
          mdxModule.MDXProvider,
          null,
          React.createElement(CaptureComponents, {
            onCapture: (components) => captured = components,
          }),
        ),
      ),
    );

    assertStrictEquals(captured?.h1, Heading);
  });

  it("gives local hook overrides precedence over provider values", () => {
    const ProviderHeading = (): React.ReactElement => React.createElement("h1", null, "provider");
    const LocalHeading = (): React.ReactElement => React.createElement("h1", null, "local");
    let captured: MDXComponents | undefined;

    renderToString(
      React.createElement(
        mdxModule.MDXProvider,
        { components: { h1: ProviderHeading } },
        React.createElement(CaptureComponents, {
          overrides: { h1: LocalHeading },
          onCapture: (components) => captured = components,
        }),
      ),
    );

    assertStrictEquals(captured?.h1, LocalHeading);
  });

  it("does not leak provider overrides into a later render", () => {
    const Heading = (): React.ReactElement => React.createElement("h1", null, "heading");
    let providerComponents: MDXComponents | undefined;
    let defaultComponents: MDXComponents | undefined;

    renderToString(
      React.createElement(
        mdxModule.MDXProvider,
        { components: { h1: Heading } },
        React.createElement(CaptureComponents, {
          onCapture: (components) => providerComponents = components,
        }),
      ),
    );
    renderToString(
      React.createElement(CaptureComponents, {
        onCapture: (components) => defaultComponents = components,
      }),
    );

    assertStrictEquals(providerComponents?.h1, Heading);
    assertEquals(defaultComponents?.h1, undefined);
  });
});
