import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as mdxModule from "./index.ts";
import * as publicMdxModule from "veryfront/mdx";
import * as mdxProviderModule from "#veryfront/react/components/MDXProvider.tsx";
import type { MDXProviderProps as BarrelMDXProviderProps } from "./index.ts";
import type { MDXProviderProps as PublicMDXProviderProps } from "veryfront/mdx";
import type { MDXProviderProps as SourceMDXProviderProps } from "#veryfront/react/components/MDXProvider.tsx";

const expectedRuntimeExports = ["MDXProvider", "useMDXComponents"];
const sampleProps = { children: null } satisfies SourceMDXProviderProps;
const barrelProps: BarrelMDXProviderProps = sampleProps;
const publicProps: PublicMDXProviderProps = sampleProps;

void barrelProps;
void publicProps;

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
});
