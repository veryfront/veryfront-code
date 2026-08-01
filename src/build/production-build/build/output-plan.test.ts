import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertSafeBuildOutputDirectory, validateBuildOutputPlan } from "./output-plan.ts";
import type { StaticAssetEntry } from "../asset-generation.ts";

function publicEntry(
  relativePath: string,
  kind: "file" | "directory" = "file",
): StaticAssetEntry {
  return {
    sourcePath: `/project/public/${relativePath}`,
    relativePath,
    kind,
    size: kind === "file" ? 1 : 0,
  };
}

describe("build/production-build/build/output-plan", () => {
  describe("assertSafeBuildOutputDirectory", () => {
    it("accepts a normal project-local dist directory", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-output-plan-" });
      try {
        await assertSafeBuildOutputDirectory(projectDir, `${projectDir}/dist`);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects replacing the project directory", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-output-plan-" });
      try {
        await assertRejects(
          () => assertSafeBuildOutputDirectory(projectDir, projectDir),
          Error,
          "must not contain or replace the project",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects output directories that contain the project", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-output-plan-" });
      const projectDir = `${root}/project`;
      await Deno.mkdir(projectDir);
      try {
        await assertRejects(
          () => assertSafeBuildOutputDirectory(projectDir, root),
          Error,
          "must not contain or replace the project",
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("rejects output inside public or configured source directories", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-output-plan-" });
      try {
        await assertRejects(
          () => assertSafeBuildOutputDirectory(projectDir, `${projectDir}/public/dist`),
          Error,
          "must not overlap a source directory",
        );
        await assertRejects(
          () =>
            assertSafeBuildOutputDirectory(projectDir, `${projectDir}/src/pages/dist`, {
              directories: { pages: "src/pages" },
            }),
          Error,
          "must not overlap a source directory",
        );
        await assertRejects(
          () =>
            assertSafeBuildOutputDirectory(projectDir, `${projectDir}/src`, {
              directories: { pages: "src/pages" },
            }),
          Error,
          "must not overlap a source directory",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects a symlink used as the output directory", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-output-plan-" });
      const projectDir = `${root}/project`;
      const targetDir = `${root}/target`;
      const outputDir = `${projectDir}/dist`;
      await Deno.mkdir(projectDir);
      await Deno.mkdir(targetDir);
      await Deno.symlink(targetDir, outputDir);
      try {
        await assertRejects(
          () => assertSafeBuildOutputDirectory(projectDir, outputDir),
          Error,
          "must not be a symbolic link",
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("rejects a dangling symlink in a nested configured source path", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-output-plan-" });
      const projectDir = `${root}/project`;
      const missingTarget = `${root}/content-target`;
      await Deno.mkdir(projectDir);
      await Deno.symlink(missingTarget, `${projectDir}/content`);
      try {
        await assertRejects(
          () =>
            assertSafeBuildOutputDirectory(
              projectDir,
              `${missingTarget}/pages/dist`,
              { directories: { pages: "content/pages" } },
            ),
          Error,
          "must not contain dangling symbolic links",
        );
        await assertRejects(() => Deno.stat(missingTarget), Deno.errors.NotFound);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  });

  describe("validateBuildOutputPlan", () => {
    it("accepts distinct routes and public assets", () => {
      validateBuildOutputPlan({
        pagesRoutes: [{ path: "/", slug: "index", file: "/project/pages/index.tsx" }],
        appRoutes: [{
          path: "/docs",
          pageFile: "/project/app/docs/page.tsx",
          segments: ["docs"],
          segmentDirs: ["/project/app", "/project/app/docs"],
        }],
        publicEntries: [
          publicEntry("images", "directory"),
          publicEntry("images/logo.png"),
        ],
      });
    });

    it("rejects Pages and App Router routes that emit the same file", () => {
      assertThrows(
        () =>
          validateBuildOutputPlan({
            pagesRoutes: [{
              path: "/about",
              slug: "about",
              file: "/project/pages/about.tsx",
            }],
            appRoutes: [{
              path: "/about",
              pageFile: "/project/app/about/page.tsx",
              segments: ["about"],
              segmentDirs: ["/project/app", "/project/app/about"],
            }],
            publicEntries: [],
          }),
        Error,
        "output collision",
      );
    });

    it("rejects inconsistent route slugs before any output is written", () => {
      assertThrows(
        () =>
          validateBuildOutputPlan({
            pagesRoutes: [{
              path: "/docs",
              slug: "../outside",
              file: "/project/pages/docs.tsx",
            }],
            appRoutes: [],
            publicEntries: [],
          }),
        Error,
        "inconsistent slug",
      );
    });

    it("rejects routes in framework-reserved namespaces", () => {
      assertThrows(
        () =>
          validateBuildOutputPlan({
            pagesRoutes: [{
              path: "/_veryfront/client",
              slug: "_veryfront/client",
              file: "/project/pages/_veryfront/client.tsx",
            }],
            appRoutes: [],
            publicEntries: [],
          }),
        Error,
        "reserved build namespace",
      );
    });

    it("rejects route paths that conflict with runtime files", () => {
      assertThrows(
        () =>
          validateBuildOutputPlan({
            pagesRoutes: [{
              path: "/sw.js",
              slug: "sw.js",
              file: "/project/pages/sw.js.tsx",
            }],
            appRoutes: [],
            publicEntries: [],
          }),
        Error,
        "output collision",
      );
    });

    it("rejects public assets that overwrite routes or runtime files", () => {
      for (
        const entry of [
          publicEntry("index.html"),
          publicEntry("sw.js"),
          publicEntry("_redirects"),
          publicEntry("_vf/assets/user.js"),
        ]
      ) {
        assertThrows(
          () =>
            validateBuildOutputPlan({
              pagesRoutes: [{
                path: "/",
                slug: "index",
                file: "/project/pages/index.tsx",
              }],
              appRoutes: [],
              publicEntries: [entry],
            }),
          Error,
        );
      }
    });

    it("rejects a public file that must also be a route directory", () => {
      assertThrows(
        () =>
          validateBuildOutputPlan({
            pagesRoutes: [{
              path: "/docs",
              slug: "docs",
              file: "/project/pages/docs.tsx",
            }],
            appRoutes: [],
            publicEntries: [publicEntry("docs")],
          }),
        Error,
        "collides",
      );
    });

    it("treats case-only path differences as portable collisions", () => {
      assertThrows(
        () =>
          validateBuildOutputPlan({
            pagesRoutes: [{
              path: "/Docs",
              slug: "Docs",
              file: "/project/pages/Docs.tsx",
            }, {
              path: "/docs",
              slug: "docs",
              file: "/project/pages/docs.tsx",
            }],
            appRoutes: [],
            publicEntries: [],
          }),
        Error,
        "output collision",
      );
    });

    it("accepts a public directory that contains a generated route directory", () => {
      validateBuildOutputPlan({
        pagesRoutes: [{
          path: "/docs",
          slug: "docs",
          file: "/project/pages/docs.tsx",
        }],
        appRoutes: [],
        publicEntries: [publicEntry("docs", "directory"), publicEntry("docs/logo.svg")],
      });
      assertEquals(true, true);
    });
  });
});
