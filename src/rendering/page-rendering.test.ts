import "#veryfront/schemas/_test-setup.ts";
import "../transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import type { EntityInfo } from "#veryfront/types";
import { handleMDXPage, prepareMDXPageBundles } from "./page-rendering.ts";

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

  it("refreshes preview caches and retries once when MDX ESM imports have stale exports", async () => {
    const pageInfo = createMDXPageInfo("# MDX Probe");
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    let loadAttempts = 0;
    let sourceRefreshes = 0;

    const adapter = {
      id: "deno",
      name: "test",
      capabilities: {
        typescript: true,
        jsx: true,
        http2: false,
        websocket: false,
        workers: false,
        fileWatching: false,
        shell: false,
        kvStore: false,
        writableFs: true,
      },
      fs: {
        refreshSourceSnapshot: () => {
          sourceRefreshes++;
          return Promise.resolve();
        },
      },
      env: {},
      server: {},
      serve: () => Promise.reject(new Error("not used")),
    } as unknown as RuntimeAdapter;

    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };

    mutableRenderer.loadModuleESM = () => {
      loadAttempts++;
      if (loadAttempts === 1) {
        throw new Error(
          "The requested module 'file:///cache/vfmod.mjs' does not provide an export named 'default'",
        );
      }

      return Promise.resolve({
        default: () => null,
      });
    };

    try {
      await handleMDXPage(
        pageInfo,
        "probe",
        "/project",
        {},
        async () => ({ compiledCode: "", frontmatter: {}, headings: [] }),
        adapter,
        {
          projectId: "project-1",
          projectSlug: "project-slug",
          contentSourceId: "preview-main",
          studioEmbed: true,
        },
      );

      assertEquals(loadAttempts, 2);
      assertEquals(sourceRefreshes, 1);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });
});
