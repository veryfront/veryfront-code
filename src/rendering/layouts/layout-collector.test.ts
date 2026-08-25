import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  discoverComponentsLayoutPath,
  extractTsxLayoutSignal,
  type FileExistenceChecker,
  LayoutCollector,
  resolveLayoutRouterRootDir,
} from "./layout-collector.ts";
import { clearLayoutDiscoveryCache } from "./utils/discovery.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { EntityInfo, MdxBundle } from "#veryfront/types";

const LAYOUT_BUNDLE = { compiledCode: "LAYOUT_CODE" } as unknown as MdxBundle;

/**
 * Adapter that reports exactly the staged files as existing. Every other stat
 * rejects, so a collector that walks past its short circuits is visible both in
 * the result and in `statPaths`.
 */
function createCollectorAdapter(
  files: Record<string, string>,
  statPaths: string[] = [],
  snapshotVersion?: { value: number },
): RuntimeAdapter {
  return {
    fs: {
      stat: (path: string) => {
        statPaths.push(path);
        if (path in files) return Promise.resolve({ isFile: true, isDirectory: false, size: 0 });
        return Promise.reject(new Error(`File not found: ${path}`));
      },
      readFile: (path: string) => {
        const content = files[path];
        if (content === undefined) return Promise.reject(new Error(`File not found: ${path}`));
        return Promise.resolve(content);
      },
      exists: (path: string) => Promise.resolve(path in files),
      readDir: async function* () {},
      writeFile: () => Promise.resolve(),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      getSourceSnapshotVersion: snapshotVersion
        ? () => Promise.resolve(snapshotVersion.value)
        : undefined,
    },
    env: { get: () => undefined },
  } as unknown as RuntimeAdapter;
}

function createPageInfo(path: string, frontmatter: Record<string, unknown> = {}): EntityInfo {
  return {
    entity: {
      id: path,
      path,
      slug: "",
      type: "page",
      content: "",
      frontmatter,
    },
  } as unknown as EntityInfo;
}

describe("LayoutCollector", () => {
  it("does not reuse layout discovery across projects that share virtual paths", async () => {
    clearLayoutDiscoveryCache();
    const sharedOptions = {
      projectDir: "/",
      contentSourceId: "preview-main",
      config: {} as VeryfrontConfig,
      compileMDX: () => Promise.resolve(LAYOUT_BUNDLE),
    };
    const projectA = new LayoutCollector({
      ...sharedOptions,
      projectId: "project-a",
      adapter: createCollectorAdapter({
        "/app/layout.tsx": "export default function Layout({ children }) { return children; }",
      }),
    });
    const projectB = new LayoutCollector({
      ...sharedOptions,
      projectId: "project-b",
      adapter: createCollectorAdapter({}),
    });

    const projectAResult = await projectA.collectLayouts(createPageInfo("/app/page.tsx"));
    const projectBResult = await projectB.collectLayouts(createPageInfo("/app/page.tsx"));

    assertEquals(projectAResult.nestedLayouts.map((layout) => layout.path), ["/app/layout.tsx"]);
    assertEquals(
      projectBResult.nestedLayouts,
      [],
      "a project without app/layout.tsx must not receive another project's cached layout",
    );
  });

  it("does not reuse layout discovery across content source snapshots", async () => {
    clearLayoutDiscoveryCache();
    const sharedOptions = {
      projectDir: "/",
      projectId: "project-a",
      config: {} as VeryfrontConfig,
      compileMDX: () => Promise.resolve(LAYOUT_BUNDLE),
    };
    const releaseA = new LayoutCollector({
      ...sharedOptions,
      contentSourceId: "release-a",
      adapter: createCollectorAdapter({
        "/app/layout.tsx": "export default function Layout({ children }) { return children; }",
      }),
    });
    const releaseB = new LayoutCollector({
      ...sharedOptions,
      contentSourceId: "release-b",
      adapter: createCollectorAdapter({}),
    });

    await releaseA.collectLayouts(createPageInfo("/app/page.tsx"));
    const releaseBResult = await releaseB.collectLayouts(createPageInfo("/app/page.tsx"));

    assertEquals(
      releaseBResult.nestedLayouts,
      [],
      "a source snapshot without app/layout.tsx must not receive a cached layout from another release",
    );
  });

  it("invalidates mutable preview discovery when the source snapshot changes", async () => {
    clearLayoutDiscoveryCache();
    const files: Record<string, string> = {
      "/app/layout.tsx": "export default function Layout({ children }) { return children; }",
    };
    const snapshot = { value: 1 };
    const collector = new LayoutCollector({
      projectDir: "/",
      projectId: "project-a",
      contentSourceId: "preview-main",
      adapter: createCollectorAdapter(files, [], snapshot),
      config: {} as VeryfrontConfig,
      compileMDX: () => Promise.resolve(LAYOUT_BUNDLE),
    });

    const initial = await collector.collectLayouts(createPageInfo("/app/page.tsx"));
    delete files["/app/layout.tsx"];
    snapshot.value = 2;
    const afterEdit = await collector.collectLayouts(createPageInfo("/app/page.tsx"));

    assertEquals(initial.nestedLayouts.map((layout) => layout.path), ["/app/layout.tsx"]);
    assertEquals(
      afterEdit.nestedLayouts,
      [],
      "a new mutable source snapshot must not reuse the previous layout discovery",
    );
  });

  it("resolves configured App Router and Pages Router roots", () => {
    const config = {
      directories: { app: "src/site", pages: "src/content" },
    } as VeryfrontConfig;

    assertEquals(
      resolveLayoutRouterRootDir("/project", true, config),
      "/project/src/site",
    );
    assertEquals(
      resolveLayoutRouterRootDir("/project", false, config),
      "/project/src/content",
    );
  });

  it("falls back to app/ and pages/ when directories are unconfigured", () => {
    assertEquals(
      resolveLayoutRouterRootDir("/project", true, {} as VeryfrontConfig),
      "/project/app",
      "App Router defaults to <projectDir>/app when directories.app is unset",
    );
    assertEquals(
      resolveLayoutRouterRootDir("/project", false, {} as VeryfrontConfig),
      "/project/pages",
      "Pages Router defaults to <projectDir>/pages when directories.pages is unset",
    );
  });

  describe("layout item creation", () => {
    const collect = async (projectDir: string, layoutFile: string) => {
      const layoutPath = `${projectDir}/components/${layoutFile}`;
      const collector = new LayoutCollector({
        projectDir,
        adapter: createCollectorAdapter({ [layoutPath]: "# layout" }),
        config: {} as VeryfrontConfig,
        compileMDX: () => Promise.resolve(LAYOUT_BUNDLE),
      });
      const result = await collector.collectLayouts(
        createPageInfo(`${projectDir}/pages/index.mdx`),
      );
      return { layoutPath, result };
    };

    it("creates an mdx item carrying the compiled bundle for .mdx layouts", async () => {
      const { layoutPath, result } = await collect("/project-mdx", "layout.mdx");
      assertEquals(
        result.nestedLayouts,
        [{ kind: "mdx", bundle: LAYOUT_BUNDLE, path: layoutPath }],
        "an mdx layout item must carry the compiled bundle or the layout renders empty",
      );
    });

    it("creates an mdx item for .md layouts too", async () => {
      const { layoutPath, result } = await collect("/project-md", "layout.md");
      assertEquals(
        result.nestedLayouts,
        [{ kind: "mdx", bundle: LAYOUT_BUNDLE, path: layoutPath }],
        ".md layouts must compile as MDX",
      );
    });

    it("creates a tsx item with a componentPath and no bundle for .tsx layouts", async () => {
      const { layoutPath, result } = await collect("/project-tsx", "layout.tsx");
      assertEquals(
        result.nestedLayouts,
        [{ kind: "tsx", component: undefined, componentPath: layoutPath, path: layoutPath }],
        "a tsx layout item must expose its componentPath and skip MDX compilation",
      );
    });
  });

  describe("discoverComponentsLayoutPath", () => {
    it("should find the first matching layout file", async () => {
      const existingFiles = new Set(["/project/components/layout.mdx"]);
      const checker: FileExistenceChecker = {
        exists: (path: string) => Promise.resolve(existingFiles.has(path)),
      };

      const result = await discoverComponentsLayoutPath("/project", checker);
      assertEquals(result, "/project/components/layout.mdx");
    });

    it("should return null when no layout file exists", async () => {
      const checker: FileExistenceChecker = {
        exists: () => Promise.resolve(false),
      };

      const result = await discoverComponentsLayoutPath("/project", checker);
      assertEquals(result, null);
    });

    it("should prefer mdx over tsx (checks mdx first)", async () => {
      const existingFiles = new Set([
        "/project/components/layout.mdx",
        "/project/components/layout.tsx",
      ]);
      const checker: FileExistenceChecker = {
        exists: (path: string) => Promise.resolve(existingFiles.has(path)),
      };

      const result = await discoverComponentsLayoutPath("/project", checker);
      assertEquals(result, "/project/components/layout.mdx");
    });

    it("should find tsx layout when no mdx/md exists", async () => {
      const existingFiles = new Set(["/project/components/layout.tsx"]);
      const checker: FileExistenceChecker = {
        exists: (path: string) => Promise.resolve(existingFiles.has(path)),
      };

      const result = await discoverComponentsLayoutPath("/project", checker);
      assertEquals(result, "/project/components/layout.tsx");
    });

    it("should find .js layout as last resort", async () => {
      const existingFiles = new Set(["/project/components/layout.js"]);
      const checker: FileExistenceChecker = {
        exists: (path: string) => Promise.resolve(existingFiles.has(path)),
      };

      const result = await discoverComponentsLayoutPath("/project", checker);
      assertEquals(result, "/project/components/layout.js");
    });

    it("should use the correct path format", async () => {
      const checkedPaths: string[] = [];
      const checker: FileExistenceChecker = {
        exists: (path: string) => {
          checkedPaths.push(path);
          return Promise.resolve(false);
        },
      };

      await discoverComponentsLayoutPath("/my-project", checker);

      assertEquals(checkedPaths.length, 6);
      assertEquals(checkedPaths[0], "/my-project/components/layout.mdx");
      assertEquals(checkedPaths[1], "/my-project/components/layout.md");
      assertEquals(checkedPaths[2], "/my-project/components/layout.tsx");
      assertEquals(checkedPaths[3], "/my-project/components/layout.jsx");
      assertEquals(checkedPaths[4], "/my-project/components/layout.ts");
      assertEquals(checkedPaths[5], "/my-project/components/layout.js");
    });
  });

  describe("layout frontmatter handling", () => {
    const collectWithDisabledLayout = async (
      projectDir: string,
      layoutValue: string | boolean,
    ) => {
      const collector = new LayoutCollector({
        projectDir,
        // An ancestor layout is staged so a collector that skips the disable
        // check has something to pick up.
        adapter: createCollectorAdapter({
          [`${projectDir}/pages/layout.tsx`]: "export default () => null;",
        }),
        config: { layout: "main" } as VeryfrontConfig,
        compileMDX: () => {
          throw new Error("compileMDX must not be called for a layout-disabled page");
        },
      });

      return await collector.collectLayouts(
        createPageInfo(`${projectDir}/pages/blog/post.mdx`, { layout: layoutValue }),
      );
    };

    it("should treat layout:false as disabled", async () => {
      assertEquals(
        await collectWithDisabledLayout("/project-layout-false", false),
        { layoutBundle: undefined, nestedLayouts: [] },
        "frontmatter layout: false must disable every layout, including config.layout and ancestor layouts",
      );
    });

    it("should treat layout:'false' string as disabled", async () => {
      assertEquals(
        await collectWithDisabledLayout("/project-layout-false-string", "false"),
        { layoutBundle: undefined, nestedLayouts: [] },
        "frontmatter layout: 'false' must disable every layout, including config.layout and ancestor layouts",
      );
    });

    it("applies the ancestor layout when the page does not opt out", async () => {
      const projectDir = "/project-layout-enabled";
      const layoutPath = `${projectDir}/pages/layout.tsx`;
      const collector = new LayoutCollector({
        projectDir,
        adapter: createCollectorAdapter({ [layoutPath]: "export default () => null;" }),
        config: {} as VeryfrontConfig,
        compileMDX: () => Promise.resolve(LAYOUT_BUNDLE),
      });

      const result = await collector.collectLayouts(
        createPageInfo(`${projectDir}/pages/blog/post.mdx`),
      );

      assertEquals(
        result.nestedLayouts.map((item) => item.path),
        [layoutPath],
        "without an opt-out the staged ancestor layout must be collected, so the disabled cases prove the opt-out",
      );
    });
  });

  describe("TSX layout export parsing", () => {
    const extract = (source: string) => extractTsxLayoutSignal(source, "pages/example.tsx");

    it("extracts direct and frontmatter layout literals", async () => {
      assertEquals(await extract('export const layout = "special";'), "special");
      assertEquals(await extract("export const frontmatter = { layout: false };"), false);
      assertEquals(await extract("export const layout = `special`;"), "special");
      assertEquals(
        await extract("export const frontmatter = { layout: `special` };"),
        "special",
      );
      assertEquals(
        await extract('const name = "special"; export const layout = `${name}`;'),
        undefined,
      );
    });

    it("prefers a frontmatter layout over a direct layout export", async () => {
      assertEquals(
        await extract(
          'export const layout = "special"; export const frontmatter = { layout: false };',
        ),
        false,
        "frontmatter.layout must win over a direct layout export so a page can opt out of layouts",
      );
      assertEquals(
        await extract(
          'export const frontmatter = { layout: false }; export const layout = "special";',
        ),
        false,
        "precedence must not depend on statement order",
      );
    });

    it("extracts separately declared exported layout bindings", async () => {
      assertEquals(
        await extract(`const layout = false;
export { layout };`),
        false,
      );
      assertEquals(
        await extract(`const metadata = { layout: "special" };
export { metadata as frontmatter };`),
        "special",
      );
      assertEquals(
        await extract(`const metadata = { layout: false };
export { metadata as "frontmatter" };`),
        false,
      );
    });

    it("ignores local declarations and layout-looking comments", async () => {
      assertEquals(
        await extract(`// export const layout = false
export default function Page() {
  const layout = false;
  return <div>{layout}</div>;
}`),
        undefined,
      );
    });

    it("does not keep a frontmatter layout value that precedes a spread", async () => {
      assertEquals(
        await extract(`const defaults = { layout: "special" };
export const frontmatter = { layout: false, ...defaults };`),
        undefined,
      );
    });

    it("uses a literal frontmatter layout that follows a spread", async () => {
      assertEquals(
        await extract(`const defaults = { layout: "special" };
export const frontmatter = { ...defaults, layout: false };`),
        false,
      );
    });

    it("ignores export-looking text inside comments and template literals", async () => {
      assertEquals(
        await extract(`/* export const frontmatter = { layout: false }; */
const example = \`export const layout = false;\`;
export default function Page() { return <pre>{example}</pre>; }`),
        undefined,
      );
    });

    it("ignores export-looking JSX child text", async () => {
      assertEquals(
        await extract(`export default function Page() {
  return <pre>export const layout = false</pre>;
}`),
        undefined,
      );
    });

    it("ignores non-literal initializers", async () => {
      assertEquals(
        await extract(`const falseLayout = "marketing";
export const layout = falseLayout;`),
        undefined,
      );
    });

    it("parses formatted frontmatter objects with trailing commas", async () => {
      assertEquals(
        await extract(`export const frontmatter = {
  layout: false,
};`),
        false,
      );
    });
  });

  describe(".veryfront path detection", () => {
    it("should not collect any layout for .veryfront pages", async () => {
      const projectDir = "/project-veryfront";
      const statPaths: string[] = [];
      const collector = new LayoutCollector({
        projectDir,
        // An ancestor layout is staged, so a collector without the guard would
        // find one.
        adapter: createCollectorAdapter(
          { [`${projectDir}/pages/layout.tsx`]: "export default () => null;" },
          statPaths,
        ),
        config: {} as VeryfrontConfig,
        compileMDX: () => {
          throw new Error("compileMDX must not run for .veryfront pages");
        },
      });

      const result = await collector.collectLayouts(
        createPageInfo(`${projectDir}/.veryfront/chat/page.tsx`),
      );

      assertEquals(
        result.layoutBundle,
        undefined,
        ".veryfront pages must not receive a layout bundle",
      );
      assertEquals(result.nestedLayouts, [], ".veryfront pages must not inherit nested layouts");
      assertEquals(
        statPaths,
        [],
        "the .veryfront short circuit must happen before any filesystem access",
      );
    });

    it("should not flag non-.veryfront paths", async () => {
      const projectDir = "/project-not-veryfront";
      const layoutPath = `${projectDir}/pages/layout.tsx`;
      const collector = new LayoutCollector({
        projectDir,
        adapter: createCollectorAdapter({ [layoutPath]: "export default () => null;" }),
        config: {} as VeryfrontConfig,
        compileMDX: () => Promise.resolve(LAYOUT_BUNDLE),
      });

      const result = await collector.collectLayouts(
        createPageInfo(`${projectDir}/pages/about.tsx`),
      );

      assertEquals(
        result.nestedLayouts.map((item) => item.path),
        [layoutPath],
        "an ordinary page must still inherit its ancestor layout",
      );
    });
  });
});
