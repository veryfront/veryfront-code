import "#veryfront/schemas/_test-setup.ts";
import "../transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { type MDXLoadModuleOptions, mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import type { EntityInfo } from "#veryfront/types";
import {
  __resetStaleMdxEsmRecoveryStateForTests,
  handleMDXPage,
  prepareMDXPageBundles,
  recoverStaleMdxEsmPreviewCaches,
} from "#veryfront/rendering/page-rendering.ts";
import { PageRenderer } from "./page-renderer.ts";
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
    __resetStaleMdxEsmRecoveryStateForTests();
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

  it("does not refresh preview caches for a render failure that is not an ESM export mismatch", async () => {
    const pageInfo = createMDXPageInfo("# MDX Probe");
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    let loadAttempts = 0;
    let sourceRefreshes = 0;

    const adapter = {
      fs: {
        refreshSourceSnapshot: () => {
          sourceRefreshes++;
          return Promise.resolve();
        },
      },
    } as unknown as RuntimeAdapter;

    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };

    mutableRenderer.loadModuleESM = () => {
      loadAttempts++;
      throw new Error("boom");
    };

    try {
      const error = await assertRejects(
        () =>
          handleMDXPage(
            pageInfo,
            "probe",
            "/project",
            {},
            () => Promise.resolve({ compiledCode: "", frontmatter: {}, headings: [] }),
            adapter,
            {
              projectId: "project-1",
              projectSlug: "project-slug",
              contentSourceId: "preview-main",
              studioEmbed: true,
            },
          ),
        Error,
        "Failed to import MDX page via ESM",
      );
      assertInstanceOf(
        error,
        Error,
        "handleMDXPage must reject with an Error carrying the original render failure",
      );

      assertEquals(
        error.message.includes("after cache refresh"),
        false,
        "an unrelated render failure must not be reported as a post-recovery failure",
      );
      assertStringIncludes(
        error.message,
        "boom",
        "the original render failure must be preserved",
      );
      assertEquals(
        loadAttempts,
        1,
        "a render failure that is not an ESM export mismatch must not be retried",
      );
      assertEquals(
        sourceRefreshes,
        0,
        "a render failure that is not an ESM export mismatch must not flush the preview source snapshot",
      );
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });

  it("does not recover preview caches for an immutable release content source", async () => {
    const pageInfo = createMDXPageInfo("# MDX Probe");
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    let loadAttempts = 0;
    let sourceRefreshes = 0;

    const adapter = {
      fs: {
        refreshSourceSnapshot: () => {
          sourceRefreshes++;
          return Promise.resolve();
        },
      },
    } as unknown as RuntimeAdapter;

    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };

    mutableRenderer.loadModuleESM = () => {
      loadAttempts++;
      throw new Error(
        "The requested module 'file:///cache/vfmod.mjs' does not provide an export named 'default'",
      );
    };

    try {
      const error = await assertRejects(
        () =>
          handleMDXPage(
            pageInfo,
            "probe",
            "/project",
            {},
            () => Promise.resolve({ compiledCode: "", frontmatter: {}, headings: [] }),
            adapter,
            {
              projectId: "project-release",
              projectSlug: "project-slug",
              contentSourceId: "release-abc123",
              mode: "production",
            },
          ),
        Error,
        "Failed to import MDX page via ESM",
      );
      assertInstanceOf(error, Error);

      assertEquals(
        sourceRefreshes,
        0,
        "a released production source must never flush its source snapshot from a public render error",
      );
      assertEquals(
        loadAttempts,
        1,
        "a released production source must not pay a cache-eviction retry for a render error",
      );
      assertEquals(
        error.message.includes("after cache refresh"),
        false,
        "no recovery ran, so the failure must not be reported as a post-recovery failure",
      );
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });

  it("recovers a preview content source at most once per cooldown window", async () => {
    const pageInfo = createMDXPageInfo("# MDX Probe");
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    let loadAttempts = 0;
    let sourceRefreshes = 0;

    const adapter = {
      fs: {
        refreshSourceSnapshot: () => {
          sourceRefreshes++;
          return Promise.resolve();
        },
      },
    } as unknown as RuntimeAdapter;

    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };

    mutableRenderer.loadModuleESM = () => {
      loadAttempts++;
      throw new Error(
        "The requested module 'file:///cache/vfmod.mjs' does not provide an export named 'default'",
      );
    };

    // No projectId, so the namespace purge is skipped and the case stays
    // hermetic; the snapshot refresh alone proves whether recovery ran.
    const renderOnce = () =>
      assertRejects(
        () =>
          handleMDXPage(
            pageInfo,
            "probe",
            "/project",
            {},
            () => Promise.resolve({ compiledCode: "", frontmatter: {}, headings: [] }),
            adapter,
            {
              projectSlug: "project-slug",
              contentSourceId: "preview-main",
              mode: "production",
            },
          ),
        Error,
        "Failed to import MDX page via ESM",
      );

    try {
      await renderOnce();
      assertEquals(sourceRefreshes, 1, "the first preview failure must recover once");
      assertEquals(loadAttempts, 2, "the first preview failure must retry once");

      await renderOnce();
      await renderOnce();

      assertEquals(
        sourceRefreshes,
        1,
        "a route that keeps failing must not refresh the source snapshot on every request",
      );
      assertEquals(
        loadAttempts,
        4,
        "requests inside the cooldown must fail without paying a second recovery retry",
      );
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });

  it("scopes recovery cooldowns and single-flight runs to the source snapshot identity", async () => {
    let sourceRefreshes = 0;
    const createAdapter = (identity: string): RuntimeAdapter => ({
      fs: {
        getSourceSnapshotIdentity: () => identity,
        refreshSourceSnapshot: () => {
          sourceRefreshes++;
          return Promise.resolve();
        },
      },
    } as unknown as RuntimeAdapter);

    const recover = (adapter: RuntimeAdapter) =>
      recoverStaleMdxEsmPreviewCaches({
        adapter,
        projectDir: "/project",
        projectId: "project-1",
        contentSourceId: "preview-main",
        slug: "probe",
        pagePath: "/probe",
        mode: "production",
      });

    assertEquals(await recover(createAdapter("branch:project-1:principal-a")), true);
    assertEquals(await recover(createAdapter("branch:project-1:principal-b")), true);
    assertEquals(
      sourceRefreshes,
      2,
      "distinct source snapshot identities must not share a recovery cooldown",
    );
  });

  it("does not share recovery cooldowns between identity-less adapters", async () => {
    let sourceRefreshes = 0;
    const createAdapter = (): RuntimeAdapter => ({
      fs: {
        refreshSourceSnapshot: () => {
          sourceRefreshes++;
          return Promise.resolve();
        },
      },
    } as unknown as RuntimeAdapter);

    const recover = (adapter: RuntimeAdapter) =>
      recoverStaleMdxEsmPreviewCaches({
        adapter,
        projectDir: "/project",
        projectId: "project-1",
        contentSourceId: "preview-main",
        slug: "probe",
        pagePath: "/probe",
        mode: "production",
      });

    assertEquals(await recover(createAdapter()), true);
    assertEquals(await recover(createAdapter()), true);
    assertEquals(
      sourceRefreshes,
      2,
      "identity-less adapters must not share a process-global recovery cooldown",
    );
  });

  it("lets a delayed identity lookup join a recovery that started after it", async () => {
    let sourceRefreshes = 0;
    const identityResolvers: Array<(identity: string) => void> = [];
    const adapter = {
      fs: {
        getSourceSnapshotIdentity: () =>
          new Promise<string>((resolve) => identityResolvers.push(resolve)),
        refreshSourceSnapshot: () => {
          sourceRefreshes++;
          return Promise.resolve();
        },
      },
    } as unknown as RuntimeAdapter;

    const recover = () =>
      recoverStaleMdxEsmPreviewCaches({
        adapter,
        projectDir: "/project",
        projectId: "project-1",
        contentSourceId: "preview-main",
        slug: "probe",
        pagePath: "/probe",
        mode: "production",
      });

    const delayed = recover();
    const fast = recover();
    assertEquals(identityResolvers.length, 2);

    identityResolvers[1]("branch:project-1:main");
    assertEquals(await fast, true);
    identityResolvers[0]("branch:project-1:main");
    assertEquals(
      await delayed,
      true,
      "a request already waiting for its key must retry after a newer recovery succeeds",
    );
    assertEquals(sourceRefreshes, 1);
  });

  it("keeps a refreshed namespace from being evicted as the oldest tracked entry", async () => {
    using time = new FakeTime();
    let sourceRefreshes = 0;

    const adapter = {
      fs: {
        refreshSourceSnapshot: () => {
          sourceRefreshes++;
          return Promise.resolve();
        },
      },
    } as unknown as RuntimeAdapter;

    const recover = (contentSourceId: string) =>
      recoverStaleMdxEsmPreviewCaches({
        adapter,
        projectDir: "/project",
        projectSlug: "project-slug",
        contentSourceId,
        slug: "probe",
        pagePath: "/probe",
        mode: "production",
      });

    // "preview-hot" is tracked first, so with insertion-order eviction it is
    // the head of the map even after a later recovery refreshes it.
    assertEquals(await recover("preview-hot"), true);

    // A second namespace stays young enough to survive the prune below, so the
    // size cap has a genuinely older entry to evict.
    time.tick(20_000);
    assertEquals(await recover("preview-cold"), true);

    // Past the cooldown, "preview-hot" recovers again and becomes the most
    // recently used namespace.
    time.tick(11_000);
    assertEquals(await recover("preview-hot"), true);

    // Fill the tracking map to its 512 namespace ceiling. The overflow must
    // evict "preview-cold", not the namespace that just recovered.
    for (let index = 0; index < 511; index++) {
      assertEquals(await recover(`preview-filler-${index}`), true);
    }

    const refreshesBeforeReprobe = sourceRefreshes;
    assertEquals(
      await recover("preview-hot"),
      false,
      "the most recently recovered namespace must still be on cooldown after the size cap evicts",
    );
    assertEquals(
      sourceRefreshes,
      refreshesBeforeReprobe,
      "an evicted cooldown entry would let the namespace refresh its source snapshot again immediately",
    );
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
    mutableRenderer.loadModuleESM = (_compiledProgramCode, options) => {
      const loadOptions = options as MDXLoadModuleOptions | undefined;
      moduleReactVersion = loadOptions?.reactVersion;
      return Promise.resolve({ default: () => null });
    };

    try {
      await handleMDXPage(
        createMDXPageInfo("# React version probe"),
        "probe",
        "/project",
        {},
        () => Promise.resolve({ compiledCode: "", frontmatter: {}, headings: [] }),
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

  it("threads the trusted local-project identity from PageRenderer into MDX loading", async () => {
    __setServerModuleLoaderForTests(() => Promise.resolve({ default: React }));

    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    let observedIsLocalProject: unknown;
    mutableRenderer.loadModuleESM = (_compiledProgramCode, options) => {
      const loadOptions = options as MDXLoadModuleOptions | undefined;
      observedIsLocalProject = loadOptions?.isLocalProject;
      return Promise.resolve({ default: () => null });
    };

    const renderer = new PageRenderer({
      projectDir: "/project",
      mode: "development",
      environment: "preview",
      config: { react: { version: "19.1.1" } },
      adapter: { fs: {} } as unknown as RuntimeAdapter,
      componentRegistry: {
        prepareDependencySnapshot: () => Promise.resolve("off"),
        getAllAsComponents: () => ({}),
      } as never,
      compileMDX: () => Promise.resolve({ compiledCode: "", frontmatter: {}, headings: [] }),
      isLocalProject: true,
    });

    try {
      await renderer.preparePageBundles(
        createMDXPageInfo("# Local MDX probe"),
        "probe",
        undefined,
        {
          projectId: "local-project",
          projectSlug: "local-project",
          contentSourceId: "local-main",
          url: new URL("http://localhost/probe"),
        },
      );

      assertEquals(observedIsLocalProject, true);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });

  it("threads the render mode from PageRenderer into MDX module loading", async () => {
    __setServerModuleLoaderForTests(() => Promise.resolve({ default: React }));

    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    const observedModes: unknown[] = [];
    mutableRenderer.loadModuleESM = (_compiledProgramCode, options) => {
      observedModes.push((options as MDXLoadModuleOptions | undefined)?.mode);
      return Promise.resolve({ default: () => null });
    };

    const renderMDXWithMode = async (mode: "development" | "production") => {
      const renderer = new PageRenderer({
        projectDir: "/project",
        mode,
        // Hosted preview: the request vocabulary says preview while the
        // compile vocabulary says production, so the production case proves
        // the compile half is what reaches the loader.
        environment: "preview",
        config: { react: { version: "19.1.1" } },
        adapter: { fs: {} } as unknown as RuntimeAdapter,
        componentRegistry: {
          prepareDependencySnapshot: () => Promise.resolve("off"),
          getAllAsComponents: () => ({}),
        } as never,
        compileMDX: () => Promise.resolve({ compiledCode: "", frontmatter: {}, headings: [] }),
      });

      await renderer.preparePageBundles(
        createMDXPageInfo("# Mode probe"),
        "probe",
        undefined,
        {
          projectId: "mode-project",
          projectSlug: "mode-project",
          contentSourceId: "release-1",
          url: new URL("http://localhost/probe"),
        },
      );
    };

    try {
      await renderMDXWithMode("production");
      await renderMDXWithMode("development");

      assertEquals(observedModes, ["production", "development"]);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });

  it("compiles MDX modules for production when the caller names no render mode", async () => {
    __setServerModuleLoaderForTests(() => Promise.resolve({ default: React }));

    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    let observedMode: unknown;
    mutableRenderer.loadModuleESM = (_compiledProgramCode, options) => {
      observedMode = (options as MDXLoadModuleOptions | undefined)?.mode;
      return Promise.resolve({ default: () => null });
    };

    try {
      await handleMDXPage(
        createMDXPageInfo("# Default mode probe"),
        "probe",
        "/project",
        {},
        () => Promise.resolve({ compiledCode: "", frontmatter: {}, headings: [] }),
        { fs: {} } as unknown as RuntimeAdapter,
        { projectId: "default-mode-project", contentSourceId: "release-1" },
      );

      assertEquals(observedMode, "production");
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });
});
