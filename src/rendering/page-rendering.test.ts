import "#veryfront/schemas/_test-setup.ts";
import "../transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import type { EntityInfo, MDXFrontmatter, PageContext } from "#veryfront/types";
import { handleMDXPage, prepareMDXPageBundles } from "./page-rendering.ts";
import {
  __setServerModuleLoaderForTests,
  resetReactCache,
} from "../react/compat/ssr-adapter/server-loader.ts";

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
  afterEach(() => {
    resetReactCache();
    __setServerModuleLoaderForTests(null);
  });

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

  it("publishes canonical frontmatter in a newly constructed PageBundle", async () => {
    const pageInfo = createMDXPageInfo("# Canonical bundle");
    const sourceDate = new Date("2026-07-24T08:30:00.000Z");
    pageInfo.entity.frontmatter = {
      title: "Bundle boundary",
      tags: "release",
      date: sourceDate,
      nested: { unsafe: true },
    };

    const { pageBundle } = await prepareMDXPageBundles(pageInfo, "/project", {
      precompiledModule: "export default function Page() {}",
    });

    assertEquals(pageBundle.frontmatter, {
      title: "Bundle boundary",
      tags: ["release"],
      date: "2026-07-24T08:30:00.000Z",
    });
    assertEquals(pageInfo.entity.frontmatter.tags, "release");
    assertEquals(pageInfo.entity.frontmatter.date, sourceDate);
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

  it("creates MDX elements with the requested project React version", async () => {
    const loadedUrls: string[] = [];
    let moduleReactVersion: unknown;
    __setServerModuleLoaderForTests((url) => {
      loadedUrls.push(url);
      return Promise.resolve({ default: React });
    });

    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    mutableRenderer.loadModuleESM = ((...args: unknown[]) => {
      moduleReactVersion = args[6];
      return Promise.resolve({ default: () => null });
    }) as typeof mdxRenderer.loadModuleESM;

    try {
      await handleMDXPage(
        createMDXPageInfo("# React version probe"),
        "probe",
        "/project",
        {},
        async () => ({ compiledCode: "", frontmatter: {}, headings: [] }),
        {
          fs: {},
        } as unknown as RuntimeAdapter,
        {
          projectId: "project-18",
          contentSourceId: "preview-main",
          studioEmbed: true,
          reactVersion: "18.3.1",
        },
      );

      assertEquals(loadedUrls.some((url) => url.includes("react@18.3.1")), true);
      assertEquals(moduleReactVersion, "18.3.1");
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });

  it("passes canonical public frontmatter to generateMetadata", async () => {
    const pageInfo = createMDXPageInfo("# Frontmatter boundary");
    pageInfo.entity.frontmatter = {
      title: "Boundary",
      tags: "release",
      date: new Date("2026-07-24T08:30:00.000Z"),
      nested: { unsafe: true },
      mixed: ["valid", 1],
    };

    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    let receivedFrontmatter: MDXFrontmatter | undefined;

    mutableRenderer.loadModuleESM = () =>
      Promise.resolve({
        default: () => null,
        generateMetadata: (context: PageContext) => {
          receivedFrontmatter = context.frontmatter;
          return {};
        },
      });

    try {
      await handleMDXPage(
        pageInfo,
        "probe",
        "/project",
        {},
        async () => ({ compiledCode: "", frontmatter: {}, headings: [] }),
        { fs: {} } as unknown as RuntimeAdapter,
      );

      assertEquals(receivedFrontmatter, {
        title: "Boundary",
        tags: ["release"],
        date: "2026-07-24T08:30:00.000Z",
      });
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });

  it("snapshots exported and generated metadata before merging", async () => {
    const pageInfo = createMDXPageInfo("# Metadata snapshot");
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    let getterCalls = 0;

    const exportedMetadata: Record<string, unknown> = {
      og: { title: "Safe OpenGraph title" },
    };
    Object.defineProperty(exportedMetadata, "unsafe", {
      enumerable: true,
      get() {
        getterCalls++;
        return "must not execute";
      },
    });
    const generatedMetadata = new Proxy({}, {
      ownKeys() {
        throw new Error("unreadable generated metadata");
      },
    });

    mutableRenderer.loadModuleESM = () =>
      Promise.resolve({
        default: () => null,
        metadata: exportedMetadata,
        generateMetadata: () => generatedMetadata,
      });

    try {
      const result = await handleMDXPage(
        pageInfo,
        "probe",
        "/project",
        {},
        async () => ({ compiledCode: "", frontmatter: {}, headings: [] }),
        { fs: {} } as unknown as RuntimeAdapter,
      );

      assertEquals(result.collectedMetadata, {
        og: { title: "Safe OpenGraph title" },
      });
      assertEquals(getterCalls, 0);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });
});
