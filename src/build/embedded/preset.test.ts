import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import {
  buildEmbeddedPreset,
  isPageFile,
  normalizeAppRoutePath,
  normalizePageRoutePath,
  presetBasename,
  presetDirname,
} from "./preset.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { createRequire } from "node:module";

const childProcess = createRequire(import.meta.url)("node:child_process") as {
  spawn: typeof import("node:child_process").spawn;
};

function observeEsbuildServices(): {
  services: Array<{
    child: ReturnType<typeof childProcess.spawn>;
    closed: boolean;
    close: Promise<void>;
  }>;
  restore: () => void;
} {
  const previousSpawn = childProcess.spawn;
  const services: Array<{
    child: ReturnType<typeof childProcess.spawn>;
    closed: boolean;
    close: Promise<void>;
  }> = [];
  const observingSpawn = ((...spawnArgs: unknown[]) => {
    const child = Reflect.apply(previousSpawn, childProcess, spawnArgs);
    const args = spawnArgs[1];
    if (
      Array.isArray(args) &&
      args.some((arg) => typeof arg === "string" && arg.startsWith("--service=")) &&
      args.includes("--ping")
    ) {
      const close = Promise.withResolvers<void>();
      const service = { child, closed: false, close: close.promise };
      services.push(service);
      child.once("close", () => {
        service.closed = true;
        close.resolve();
      });
    }
    return child;
  }) as typeof childProcess.spawn;
  childProcess.spawn = observingSpawn;

  return {
    services,
    restore() {
      if (childProcess.spawn === observingSpawn) childProcess.spawn = previousSpawn;
    },
  };
}

describe("build/embedded/preset", () => {
  it("builds entries and routes from configured app and pages directories", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-embedded-custom-routes-" });
    const projectDir = join(root, "project");
    const outDir = join(root, "dist");
    try {
      await Deno.mkdir(join(projectDir, "src/app/docs"), { recursive: true });
      await Deno.mkdir(join(projectDir, "src/pages"), { recursive: true });
      await Deno.writeTextFile(join(projectDir, "src/app/page.md"), "# Home");
      await Deno.writeTextFile(join(projectDir, "src/app/docs/page.md"), "# Docs");
      await Deno.writeTextFile(join(projectDir, "src/pages/about.md"), "# About");

      const result = await buildEmbeddedPreset({
        projectDir,
        outDir,
        runtime: "deno",
        config: {
          directories: { app: "src/app", pages: "src/pages" },
        },
      });

      assertEquals(result.manifest.routes.some((route) => route.path === "/docs"), true);
      assertEquals(result.manifest.routes.some((route) => route.path === "/about"), true);
      assertEquals(
        result.manifest.routes.filter((route) => route.path === "/").length,
        1,
      );

      const clientDom = await Deno.readTextFile(
        join(outDir, "embedded", "rsc", "client-dom.js"),
      );
      const hydrateClient = await Deno.readTextFile(
        join(outDir, "embedded", "rsc", "hydrate-client.js"),
      );
      assertEquals(clientDom.includes("#veryfront/"), false);
      assertEquals(hydrateClient.includes("#veryfront/"), false);
      assertStringIncludes(clientDom, "consumeNdjsonStream");
      assertStringIncludes(hydrateClient, "hydrateAllClientBoundaries");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("does not resurrect a deleted owned stage while creating nested output", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-embedded-missing-stage-" });
    const projectDir = join(root, "project");
    const outDir = join(root, "dist");
    const outputDir = join(outDir, "embedded");
    await Deno.mkdir(join(projectDir, "app"), { recursive: true });
    await Deno.mkdir(outputDir, { recursive: true });
    await Deno.writeTextFile(join(projectDir, "app/page.md"), "# Home");
    await Deno.writeTextFile(join(outputDir, "sentinel.txt"), "known good");

    const originalMkdir = Deno.mkdir;
    let stagePath: string | undefined;
    let removedStage = false;
    const interceptingMkdir: typeof Deno.mkdir = async (path, options) => {
      const stringPath = String(path);
      if (stagePath === undefined && stringPath.includes(".embedded.veryfront-stage-")) {
        stagePath = stringPath;
      } else if (
        !removedStage && stagePath !== undefined &&
        stringPath.startsWith(`${stagePath}/`)
      ) {
        removedStage = true;
        await Deno.remove(stagePath, { recursive: true });
      }
      return await originalMkdir(path, options);
    };
    Deno.mkdir = interceptingMkdir;
    try {
      await assertRejects(() =>
        buildEmbeddedPreset({
          projectDir,
          outDir,
          runtime: "deno",
          config: { directories: { app: "app", pages: "pages" } },
        })
      );
      assertEquals(removedStage, true);
      await assertRejects(() => Deno.stat(stagePath!), Deno.errors.NotFound);
      assertEquals(await Deno.readTextFile(join(outputDir, "sentinel.txt")), "known good");
    } finally {
      if (Deno.mkdir === interceptingMkdir) Deno.mkdir = originalMkdir;
      await Deno.remove(root, { recursive: true });
    }
  });

  it("bundles project aliases and nested MDX dependencies into each route", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-embedded-route-imports-" });
    const projectDir = join(root, "project");
    const outDir = join(root, "dist");
    try {
      await Deno.mkdir(join(projectDir, "app", "blog"), { recursive: true });
      await Deno.mkdir(join(projectDir, "components"), { recursive: true });
      await Deno.writeTextFile(join(projectDir, "app", "page.mdx"), "# Home");
      await Deno.writeTextFile(
        join(projectDir, "components", "Button.tsx"),
        "export function Button(){ return <span>Bundled component marker</span> }",
      );
      await Deno.writeTextFile(
        join(projectDir, "components", "Section.mdx"),
        "# Nested MDX marker",
      );
      await Deno.writeTextFile(
        join(projectDir, "app", "blog", "page.mdx"),
        [
          'import { Button } from "@/components/Button.tsx"',
          'import Section from "@/components/Section.mdx"',
          "",
          "<Button />",
          "<Section />",
        ].join("\n"),
      );

      await buildEmbeddedPreset({
        projectDir,
        outDir,
        runtime: "deno",
        config: {},
      });

      const code = await Deno.readTextFile(
        join(outDir, "embedded", "app", "blog.js"),
      );
      assertStringIncludes(code, "Bundled component marker");
      assertStringIncludes(code, "Nested MDX marker");
      assertEquals(code.includes("@/components"), false);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("fails the whole build when a non-entry route cannot bundle", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-embedded-route-failure-" });
    const projectDir = join(root, "project");
    const outDir = join(root, "dist");
    try {
      await Deno.mkdir(join(projectDir, "app", "broken"), { recursive: true });
      await Deno.mkdir(join(outDir, "embedded"), { recursive: true });
      await Deno.writeTextFile(join(projectDir, "app", "page.mdx"), "# Home");
      await Deno.writeTextFile(
        join(projectDir, "app", "broken", "page.mdx"),
        'import Missing from "./missing.tsx"\n\n<Missing />',
      );
      await Deno.writeTextFile(
        join(outDir, "embedded", "previous.txt"),
        "previous",
      );

      await assertRejects(() =>
        buildEmbeddedPreset({
          projectDir,
          outDir,
          runtime: "deno",
          config: {},
        })
      );

      assertEquals(
        await Deno.readTextFile(join(outDir, "embedded", "previous.txt")),
        "previous",
      );
      await assertRejects(
        () => Deno.stat(join(outDir, "embedded", "app.js")),
        Deno.errors.NotFound,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rejects route collisions instead of selecting one by traversal order", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-embedded-route-collision-" });
    const projectDir = join(root, "project");
    const outDir = join(root, "dist");
    try {
      await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
      await Deno.writeTextFile(join(projectDir, "pages", "about.md"), "# Markdown");
      await Deno.writeTextFile(join(projectDir, "pages", "about.mdx"), "# MDX");

      await assertRejects(
        () =>
          buildEmbeddedPreset({
            projectDir,
            outDir,
            runtime: "deno",
            config: {},
          }),
        Error,
        "Duplicate embedded route",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("uses an in-memory fallback without modifying the project", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-embedded-fallback-" });
    const projectDir = join(root, "project");
    const outDir = join(root, "dist");
    await Deno.mkdir(projectDir);

    try {
      const result = await buildEmbeddedPreset({
        projectDir,
        outDir,
        runtime: "deno",
        config: {},
      });

      assertEquals(result.manifest.routes, [{
        path: "/",
        file: "embedded/app.js",
        type: "page",
      }]);
      await assertRejects(
        () => Deno.stat(join(projectDir, ".veryfront")),
        Deno.errors.NotFound,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rejects source directory traversal and route symlinks", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-embedded-source-safety-" });
    const projectDir = join(root, "project");
    const outDir = join(root, "dist");
    const outsideDir = join(root, "outside");
    await Deno.mkdir(projectDir);
    await Deno.mkdir(outsideDir);

    try {
      await assertRejects(
        () =>
          buildEmbeddedPreset({
            projectDir,
            outDir,
            runtime: "deno",
            config: { directories: { app: "../outside" } },
          }),
        TypeError,
        "canonical project-relative",
      );

      await Deno.mkdir(join(projectDir, "app"));
      await Deno.symlink(outsideDir, join(projectDir, "app", "linked"));
      await assertRejects(
        () =>
          buildEmbeddedPreset({
            projectDir,
            outDir,
            runtime: "deno",
            config: {},
          }),
        Error,
        "symbolic links",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rejects lexical and symlinked module-import escapes", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-embedded-import-safety-" });
    const projectDir = join(root, "project");
    const outDir = join(root, "dist");
    const outsideModule = join(root, "Outside.tsx");
    await Deno.mkdir(join(projectDir, "app"), { recursive: true });
    await Deno.mkdir(join(projectDir, "components"), { recursive: true });
    await Deno.writeTextFile(
      outsideModule,
      'export default function Outside(){ return "secret marker" }',
    );

    try {
      await Deno.writeTextFile(
        join(projectDir, "app", "page.mdx"),
        'import Outside from "../../Outside.tsx"\n\n<Outside />',
      );
      await assertRejects(
        () =>
          buildEmbeddedPreset({
            projectDir,
            outDir,
            runtime: "deno",
            config: {},
          }),
        Error,
        "outside the project",
      );

      await Deno.symlink(
        outsideModule,
        join(projectDir, "components", "Outside.tsx"),
      );
      await Deno.writeTextFile(
        join(projectDir, "app", "page.mdx"),
        'import Outside from "@/components/Outside.tsx"\n\n<Outside />',
      );
      await assertRejects(
        () =>
          buildEmbeddedPreset({
            projectDir,
            outDir,
            runtime: "deno",
            config: {},
          }),
        Error,
        "symbolic link",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("stops the bundler when the embedded app bundle fails", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-embedded-failed-bundle-" });
    const projectDir = join(root, "project");
    const outDir = join(root, "dist");
    const observation = observeEsbuildServices();
    const { services } = observation;
    let buildError: unknown;

    try {
      await Deno.mkdir(join(projectDir, "app"), { recursive: true });
      await Deno.writeTextFile(
        join(projectDir, "app/page.mdx"),
        'import Missing from "./missing.tsx"\n\n<Missing />',
      );
      await Deno.mkdir(join(outDir, "embedded"), { recursive: true });
      await Deno.writeTextFile(join(outDir, "embedded", "previous.txt"), "previous");

      try {
        await buildEmbeddedPreset({
          projectDir,
          outDir,
          runtime: "deno",
          config: {},
        });
      } catch (error) {
        buildError = error;
      }

      assertEquals(buildError instanceof Error, true);
      assertEquals(services.length >= 1, true);
      assertEquals(services.every((service) => service.closed), true);
      assertEquals(
        await Deno.readTextFile(join(outDir, "embedded", "previous.txt")),
        "previous",
      );
      assertEquals(
        [...Deno.readDirSync(outDir)].some((entry) =>
          entry.name.includes(".embedded.veryfront-stage-") ||
          entry.name.includes(".embedded.veryfront-backup-") ||
          entry.name === ".embedded.veryfront-build.lock"
        ),
        false,
      );
    } finally {
      for (const service of services) service.child.ref();
      try {
        const { stop } = await import("veryfront/extensions/bundler");
        await stop();
        await Promise.all(services.map((service) => service.close));
      } finally {
        for (const service of services) service.child.unref();
        observation.restore();
        await Deno.remove(root, { recursive: true });
      }
    }
  });

  it("stops an active bundler when config resolution fails", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-embedded-invalid-config-" });
    const projectDir = join(root, "project");
    const outDir = join(root, "dist");
    const observation = observeEsbuildServices();
    const { services } = observation;
    let buildError: unknown;

    try {
      await Deno.mkdir(projectDir, { recursive: true });
      await Deno.writeTextFile(
        join(projectDir, "veryfront.config.ts"),
        "export default { invalid: ; };",
      );

      const { transform } = await import("veryfront/extensions/bundler");
      await transform("export const warm: number = 1;", { loader: "ts" });

      try {
        await buildEmbeddedPreset({ projectDir, outDir, runtime: "deno" });
      } catch (error) {
        buildError = error;
      }

      assertEquals(buildError instanceof Error, true);
      assertEquals(services.length >= 1, true);
      assertEquals(services.every((service) => service.closed), true);
    } finally {
      for (const service of services) service.child.ref();
      try {
        const { stop } = await import("veryfront/extensions/bundler");
        await stop();
        await Promise.all(services.map((service) => service.close));
      } finally {
        for (const service of services) service.child.unref();
        observation.restore();
        await Deno.remove(root, { recursive: true });
      }
    }
  });

  describe("presetDirname", () => {
    it("should return parent directory for nested path", () => {
      assertEquals(presetDirname("/home/user/file.ts"), "/home/user", "should strip filename");
    });

    it("should return empty string for filename without directory", () => {
      assertEquals(presetDirname("file.ts"), "", "should return empty for bare filename");
    });

    it("should handle root-level file", () => {
      assertEquals(presetDirname("/file.ts"), "", "should return empty for root file");
    });

    it("should handle deeply nested path", () => {
      assertEquals(
        presetDirname("/a/b/c/d/e.ts"),
        "/a/b/c/d",
        "should return parent of deep path",
      );
    });

    it("should handle path ending with slash", () => {
      assertEquals(presetDirname("/a/b/"), "/a/b", "should handle trailing slash");
    });
  });

  describe("presetBasename", () => {
    it("should return filename from path", () => {
      assertEquals(presetBasename("/home/user/file.ts"), "file.ts", "should extract filename");
    });

    it("should return the input if no directory separator", () => {
      assertEquals(presetBasename("file.ts"), "file.ts", "should return input as-is");
    });

    it("should handle deeply nested path", () => {
      assertEquals(
        presetBasename("/a/b/c/d/e.ts"),
        "e.ts",
        "should extract basename from deep path",
      );
    });

    it("should return empty string for path ending with slash", () => {
      assertEquals(presetBasename("/a/b/"), "", "trailing slash yields empty basename");
    });
  });

  describe("normalizeAppRoutePath", () => {
    it("should normalize empty string to /", () => {
      assertEquals(normalizeAppRoutePath(""), "/", "empty path should become /");
    });

    it("should preserve leading slash", () => {
      assertEquals(normalizeAppRoutePath("/about"), "/about", "should keep existing leading slash");
    });

    it("should add leading slash when missing", () => {
      assertEquals(normalizeAppRoutePath("about"), "/about", "should add leading slash");
    });

    it("should handle nested route paths", () => {
      assertEquals(
        normalizeAppRoutePath("blog/posts"),
        "/blog/posts",
        "should normalize nested path",
      );
    });

    it("should handle / input", () => {
      assertEquals(normalizeAppRoutePath("/"), "/", "should preserve single slash");
    });
  });

  describe("normalizePageRoutePath", () => {
    it("should strip .mdx extension and add leading slash", () => {
      assertEquals(normalizePageRoutePath("about.mdx"), "/about", "should normalize .mdx path");
    });

    it("should strip .md extension and add leading slash", () => {
      assertEquals(normalizePageRoutePath("about.md"), "/about", "should normalize .md path");
    });

    it("should handle nested page paths", () => {
      assertEquals(
        normalizePageRoutePath("blog/post.mdx"),
        "/blog/post",
        "should normalize nested page path",
      );
    });

    it("should collapse duplicate slashes", () => {
      assertEquals(
        normalizePageRoutePath("//blog//post.mdx"),
        "/blog/post",
        "should collapse duplicate slashes",
      );
    });

    it("should handle index files", () => {
      assertEquals(
        normalizePageRoutePath("index.mdx"),
        "/index",
        "should normalize index page",
      );
    });
  });

  describe("isPageFile", () => {
    it("should accept .mdx files", () => {
      assertEquals(isPageFile("page.mdx"), true, "should accept .mdx");
    });

    it("should accept .md files", () => {
      assertEquals(isPageFile("page.md"), true, "should accept .md");
    });

    it("should reject .ts files", () => {
      assertEquals(isPageFile("page.ts"), false, "should reject .ts");
    });

    it("should reject .jsx files", () => {
      assertEquals(isPageFile("page.jsx"), false, "should reject .jsx");
    });

    it("should reject underscore-prefixed .mdx files", () => {
      assertEquals(isPageFile("_layout.mdx"), false, "should reject _-prefixed files");
    });

    it("should reject underscore-prefixed .md files", () => {
      assertEquals(isPageFile("_draft.md"), false, "should reject _-prefixed .md files");
    });

    it("should accept nested filenames", () => {
      assertEquals(isPageFile("about.mdx"), true, "should accept regular .mdx");
    });
  });
});
