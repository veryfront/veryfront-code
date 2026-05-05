import "../transforms/mdx/compiler/__tests__/content-transformer-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { EntityInfo } from "#veryfront/types";
import { prepareMDXPageBundles } from "./page-rendering.ts";

function createMDXPageInfo(content: string): EntityInfo {
  return {
    entity: {
      id: "page-1",
      path: "/project/pages/probe.mdx",
      slug: "probe",
      type: "page",
      content,
      frontmatter: {},
      kind: "mdx",
      isPage: true,
      isLayout: false,
      isComponent: false,
    },
  };
}

describe("rendering/page-rendering", () => {
  it("keeps SSR module code separate from the browser client bundle", async () => {
    const pageInfo = createMDXPageInfo(
      [
        'import { Marker } from "../components/Marker.tsx";',
        "",
        "# MDX Probe",
        "",
        "<Marker />",
      ].join("\n"),
    );

    const { pageBundle, serverModuleCode } = await prepareMDXPageBundles(pageInfo, "/project");

    assert(serverModuleCode.includes("file:///project/components/Marker.tsx"));
    assertEquals(serverModuleCode.includes("/_veryfront/fs/"), false);

    assert(pageBundle.clientModuleCode?.includes("/_veryfront/fs/"));
    assertEquals(pageBundle.compiledCode, serverModuleCode);
  });

  it("preserves a precompiled browser bundle without leaking it into SSR", async () => {
    const pageInfo = createMDXPageInfo(
      [
        'import { Marker } from "../components/Marker.tsx";',
        "",
        "# MDX Probe",
        "",
        "<Marker />",
      ].join("\n"),
    );

    const precompiledModule = 'export default function MDXContent() { return "client"; }';
    const { pageBundle, serverModuleCode } = await prepareMDXPageBundles(pageInfo, "/project", {
      precompiledModule,
    });

    assertEquals(pageBundle.clientModuleCode, precompiledModule);
    assert(serverModuleCode.includes("file:///project/components/Marker.tsx"));
    assertEquals(serverModuleCode.includes("/_veryfront/fs/"), false);
  });
});
