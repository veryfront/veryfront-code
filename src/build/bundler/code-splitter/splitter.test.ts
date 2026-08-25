import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  makeTempDir,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { type BuildContext, stop } from "veryfront/extensions/bundler";
import { CodeSplitter, rebuildAndDispose } from "./splitter.ts";
import { generatePreloadLinks } from "./index.ts";

async function readJsOutputs(dir: string): Promise<string> {
  let contents = "";

  for await (const entry of readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      contents += await readJsOutputs(path);
      continue;
    }

    if (entry.isFile && entry.name.endsWith(".js")) {
      contents += await readTextFile(path);
      contents += "\n";
    }
  }

  return contents;
}

describe("build/bundler/code-splitter/splitter", () => {
  describe("CodeSplitter constructor", () => {
    it("should create an instance with options", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [],
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });

    it("should accept development mode", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "development",
        routes: [{ path: "/", file: "/project/src/index.tsx" }],
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });

    it("should accept routes with names", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [
          { path: "/", file: "/project/src/index.tsx", name: "index" },
          { path: "/about", file: "/project/src/about.tsx", name: "about" },
        ],
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });

    it("should accept optional external and shared config", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [],
        shared: ["react", "react-dom"],
        external: ["lodash"],
        moduleResolution: "bundled",
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });
  });

  describe("split method", () => {
    it("should have a split method", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [],
      });
      assertEquals(typeof splitter.split, "function");
    });

    it("disposes the build context when rebuild fails", async () => {
      const rebuildError = new Error("intentional rebuild failure");
      let disposed = false;
      const buildContext: BuildContext = {
        rebuild() {
          return Promise.reject(rebuildError);
        },
        dispose() {
          disposed = true;
          return Promise.resolve();
        },
      };

      const error = await assertRejects(
        () => rebuildAndDispose(buildContext),
        Error,
        "intentional rebuild failure",
      );

      assertEquals(error, rebuildError);
      assertEquals(disposed, true);
    });

    it("preserves the rebuild error when disposal also fails", async () => {
      const rebuildError = new Error("primary rebuild failure");
      const buildContext: BuildContext = {
        rebuild() {
          return Promise.reject(rebuildError);
        },
        dispose() {
          return Promise.reject(new Error("secondary disposal failure"));
        },
      };

      const error = await assertRejects(
        () => rebuildAndDispose(buildContext),
        Error,
        "primary rebuild failure",
      );

      assertEquals(error, rebuildError);
    });

    it("strips server-only page dependencies before building production browser chunks", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-splitter-project-" });
      const outDir = await makeTempDir({ prefix: "vf-splitter-out-" });
      const previousCodeParser = tryResolve<unknown>("CodeParser");
      unregister("CodeParser");

      try {
        await mkdir(join(projectDir, "app"), { recursive: true });
        const pagePath = join(projectDir, "app/page.tsx");
        await writeTextFile(
          pagePath,
          [
            `import { notFound } from "veryfront";`,
            `import "vf-external-probe";`,
            `import { hashSecret } from "./server-helper.ts";`,
            `export async function getServerData() {`,
            `  if (!hashSecret("candidate")) notFound();`,
            `  return { props: { ok: true } };`,
            `}`,
            `export default function Page() { return "browser page"; }`,
          ].join("\n"),
        );
        await writeTextFile(
          join(projectDir, "app/server-helper.ts"),
          [
            `import { createHash } from "node:crypto";`,
            `export function hashSecret(value: string): string {`,
            `  return createHash("sha256").update(value).digest("hex");`,
            `}`,
          ].join("\n"),
        );

        const splitter = new CodeSplitter({
          projectDir,
          outDir,
          mode: "production",
          routes: [{ path: "/", file: pagePath, name: "index" }],
          moduleResolution: "bundled",
          external: ["vf-external-probe"],
        });

        const result = await splitter.split();
        assertEquals(tryResolve("CodeParser") !== undefined, true);
        const browserOutputs = await readJsOutputs(outDir);

        const routeEntries = Object.entries(result.manifest.routes);
        assertEquals(
          routeEntries.map(([routePath]) => routePath),
          ["/"],
          "the split must map the built route under its route path, not its source filename",
        );
        const route = routeEntries[0]?.[1];
        assertExists(route, "the mapped route must carry chunk metadata");
        assertExists(
          result.manifest.chunks[route.entry],
          "the route entry must be one of the emitted chunks",
        );
        assertEquals(
          result.entries.has(route.entry),
          true,
          "the route entry chunk must be reported as an entry, not a shared chunk",
        );
        assertEquals(
          result.shared.has(route.entry),
          false,
          "the route entry chunk must not also be reported as shared",
        );
        assertEquals(
          browserOutputs.includes("vf-external-probe"),
          true,
          "externals declared on SplitOptions stay unbundled",
        );
        assertEquals(browserOutputs.includes("browser page"), true);
        assertEquals(browserOutputs.includes("node:crypto"), false);
        assertEquals(browserOutputs.includes("createHash"), false);
        assertEquals(browserOutputs.includes("hashSecret"), false);
        assertEquals(browserOutputs.includes("notFound"), false);
      } finally {
        await stop();
        if (previousCodeParser) register("CodeParser", previousCodeParser);
        else unregister("CodeParser");
        await remove(projectDir, { recursive: true });
        await remove(outDir, { recursive: true });
      }
    });

    it("keys App Router and nested routes by route path so preload hints resolve", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-splitter-routes-" });
      const outDir = await makeTempDir({ prefix: "vf-splitter-routes-out-" });
      const previousCodeParser = tryResolve<unknown>("CodeParser");
      unregister("CodeParser");

      try {
        await mkdir(join(projectDir, "app/blog"), { recursive: true });
        await mkdir(join(projectDir, "app/docs"), { recursive: true });
        await writeTextFile(
          join(projectDir, "app/page.tsx"),
          `export default function Page() { return "home"; }`,
        );
        await writeTextFile(
          join(projectDir, "app/blog/page.tsx"),
          `export default function BlogPage() { return "blog"; }`,
        );
        await writeTextFile(
          join(projectDir, "app/docs/page.tsx"),
          `export default function DocsPage() { return "docs"; }`,
        );
        await writeTextFile(
          join(projectDir, "app/blog/post.tsx"),
          `export default function Post() { return "post"; }`,
        );

        const splitter = new CodeSplitter({
          projectDir,
          outDir,
          mode: "production",
          moduleResolution: "bundled",
          routes: [
            // Three App Router pages whose source basenames all reduce to "page",
            // plus a nested route whose entry name is dashed rather than nested.
            { path: "/", file: join(projectDir, "app/page.tsx"), name: "index" },
            { path: "/blog", file: join(projectDir, "app/blog/page.tsx"), name: "blog" },
            { path: "/docs", file: join(projectDir, "app/docs/page.tsx"), name: "docs" },
            { path: "/blog/post", file: join(projectDir, "app/blog/post.tsx"), name: "blog-post" },
          ],
        });

        const { manifest } = await splitter.split();

        assertEquals(
          Object.keys(manifest.routes).sort(),
          ["/", "/blog", "/blog/post", "/docs"],
          "each route must be keyed by its own path; App Router pages must not collapse onto a single /page key",
        );
        assertEquals(
          manifest.routes["/blog"]?.entry,
          "blog.js",
          "a route must point at the chunk built from its own entry",
        );
        assertEquals(
          manifest.routes["/blog/post"]?.entry,
          "blog-post.js",
          "a nested route must point at the chunk built from its own entry",
        );

        for (const routePath of ["/", "/blog", "/blog/post", "/docs"]) {
          const links = generatePreloadLinks(manifest, routePath, "/_veryfront/chunks");
          assertEquals(
            links.includes("modulepreload"),
            true,
            `route ${routePath} must ship a modulepreload hint rather than resolving to an empty string`,
          );
        }
      } finally {
        await stop();
        if (previousCodeParser) register("CodeParser", previousCodeParser);
        else unregister("CodeParser");
        await remove(projectDir, { recursive: true });
        await remove(outDir, { recursive: true });
      }
    });
  });
});
