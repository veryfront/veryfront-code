import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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
      await Deno.writeTextFile(join(projectDir, "app/page.md"), "# Home");
      await Deno.mkdir(join(outDir, "embedded", "manifest.json"), { recursive: true });

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
