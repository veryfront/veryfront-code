import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertConfiguredBuildOutputPhysicallyContained,
  buildCommand,
  formatBuildOutputPath,
  releaseBuildExtensions,
  resolveBuildOutputDir,
  runWithBundlerShutdown,
} from "./command.ts";
import type { BuildOptions } from "./types.ts";
import { makeTempDir, mkdir, remove, symlink } from "#veryfront/platform/compat/fs.ts";
import { join } from "veryfront/platform/path";
import { runtime } from "veryfront/platform";

describe("commands/build/command", () => {
  describe("buildCommand", () => {
    it("is exported as a function", () => {
      assertExists(buildCommand);
      assertEquals(typeof buildCommand, "function");
    });

    it("accepts a single BuildOptions parameter", () => {
      assertEquals(buildCommand.length, 1);
    });

    it("awaits bundler shutdown before returning a successful result", async () => {
      const order: string[] = [];

      const result = await runWithBundlerShutdown(
        async () => {
          order.push("build");
          return "complete";
        },
        async () => {
          await Promise.resolve();
          order.push("stop");
        },
      );

      assertEquals(result, "complete");
      assertEquals(order, ["build", "stop"]);
    });

    it("stops the bundler and preserves the build error", async () => {
      const buildError = new Error("intentional build failure");
      let stopped = false;

      const error = await assertRejects(
        () =>
          runWithBundlerShutdown(
            () => Promise.reject(buildError),
            () => {
              stopped = true;
              return Promise.reject(new Error("secondary shutdown failure"));
            },
          ),
        Error,
        "intentional build failure",
      );

      assertEquals(error, buildError);
      assertEquals(stopped, true);
    });
  });

  describe("releaseBuildExtensions", () => {
    it("tears down the composed extensions", async () => {
      let torndown = 0;
      await releaseBuildExtensions({
        teardownAll: () => {
          torndown++;
          return Promise.resolve();
        },
      });
      assertEquals(torndown, 1);
    });

    it("does nothing when no extensions were composed", async () => {
      // The build can fail before composition, so the release path runs with
      // nothing to release and must not throw.
      await releaseBuildExtensions(undefined);
    });

    it("does not let a teardown failure change the build outcome", async () => {
      // The build has already produced its result. runWithBundlerShutdown sets
      // the same precedent by preserving the build error over a shutdown one.
      await releaseBuildExtensions({
        teardownAll: () => Promise.reject(new Error("teardown exploded")),
      });
    });
  });

  describe("formatBuildOutputPath", () => {
    it("reports the default output relative to the project", () => {
      assertEquals(
        formatBuildOutputPath("/workspace/project", "/workspace/project/dist"),
        "dist",
      );
    });

    it("preserves the location of output outside the project", () => {
      assertEquals(
        formatBuildOutputPath("/workspace/project", "/workspace/shared/dist"),
        "../shared/dist",
      );
    });
  });

  describe("resolveBuildOutputDir", () => {
    it("honors build.outDir from veryfront.config.ts", () => {
      // build.outDir was parsed into the config and then ignored: the build
      // wrote and cleared dist/ anyway, so a project could not move the
      // framework's output away from its own dist/.
      assertEquals(
        resolveBuildOutputDir("/workspace/project", undefined, {
          build: { outDir: "custom-out" },
        }),
        "/workspace/project/custom-out",
      );
    });

    it("allows an in-project build.outDir beginning with two dots", () => {
      assertEquals(
        resolveBuildOutputDir("/workspace/project", undefined, {
          build: { outDir: "..cache" },
        }),
        "/workspace/project/..cache",
      );
    });

    it("lets -o/--output override build.outDir", () => {
      assertEquals(
        resolveBuildOutputDir("/workspace/project", "flagout", {
          build: { outDir: "custom-out" },
        }),
        "flagout",
      );
    });

    it("still rejects an external build.outDir when --output overrides it", () => {
      assertThrows(
        () =>
          resolveBuildOutputDir("/workspace/project", "dist", {
            build: { outDir: "../release" },
          }),
        Error,
        "inside the project",
      );
    });

    it("still rejects a project-root build.outDir when --output overrides it", () => {
      assertThrows(
        () =>
          resolveBuildOutputDir("/workspace/project", "dist", {
            build: { outDir: "." },
          }),
        Error,
        "inside the project",
      );
    });

    it("falls back to dist when no output is configured", () => {
      assertEquals(
        resolveBuildOutputDir("/workspace/project", undefined, {}),
        "/workspace/project/dist",
      );
    });

    it("rejects an absolute build.outDir outside the project", () => {
      assertThrows(
        () =>
          resolveBuildOutputDir("/workspace/project", undefined, {
            build: { outDir: "/var/www/site" },
          }),
        Error,
        "inside the project",
      );
    });

    it("rejects a build.outDir that is the project directory", () => {
      // The build clears its output directory before writing, so honoring
      // `outDir: "."` would recursively delete the project's own source.
      assertThrows(
        () => resolveBuildOutputDir("/workspace/project", undefined, { build: { outDir: "." } }),
        Error,
        "build.outDir",
      );
    });

    it("rejects a build.outDir that contains the project directory", () => {
      assertThrows(
        () => resolveBuildOutputDir("/workspace/project", undefined, { build: { outDir: ".." } }),
        Error,
        "inside the project",
      );
    });

    it("rejects an -o/--output that contains the project directory", () => {
      assertThrows(
        () => resolveBuildOutputDir("/workspace/project", "..", {}),
        Error,
        "-o/--output",
      );
    });

    it("rejects build.outDir beside the project", () => {
      assertThrows(
        () =>
          resolveBuildOutputDir("/workspace/project", undefined, {
            build: { outDir: "../shared-dist" },
          }),
        Error,
        "inside the project",
      );
    });
  });

  describe("configured output physical containment", () => {
    it("rejects an absent output below an intermediate symlink", async () => {
      const tempDir = await makeTempDir({ prefix: "veryfront-build-output-" });
      const projectDir = join(tempDir, "project");
      const externalDir = join(tempDir, "external");
      await mkdir(projectDir, { recursive: true });
      await mkdir(externalDir, { recursive: true });
      await symlink(externalDir, join(projectDir, "link"));

      try {
        const adapter = await runtime.get();
        await assertRejects(
          () =>
            assertConfiguredBuildOutputPhysicallyContained(adapter, projectDir, {
              build: { outDir: "link/release" },
            }),
          Error,
          "physically inside the project",
        );
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });

    it("accepts an absent output below the physical project directory", async () => {
      const tempDir = await makeTempDir({ prefix: "veryfront-build-output-" });
      const projectDir = join(tempDir, "project");
      await mkdir(projectDir, { recursive: true });

      try {
        const adapter = await runtime.get();
        await assertConfiguredBuildOutputPhysicallyContained(adapter, projectDir, {
          build: { outDir: "nested/release" },
        });
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });
  });

  describe("BuildOptions interface", () => {
    it("supports required projectDir field", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
      };
      assertEquals(options.projectDir, "/path/to/project");
    });

    it("supports optional outputDir", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        outputDir: "/path/to/dist",
      };
      assertEquals(options.outputDir, "/path/to/dist");
    });

    it("supports splitting option", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        splitting: true,
      };
      assertEquals(options.splitting, true);
    });

    it("supports compress option", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        compress: true,
      };
      assertEquals(options.compress, true);
    });

    it("supports prefetch option", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        prefetch: false,
      };
      assertEquals(options.prefetch, false);
    });

    it("supports ssg option", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        ssg: true,
      };
      assertEquals(options.ssg, true);
    });

    it("supports dryRun option", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        dryRun: true,
      };
      assertEquals(options.dryRun, true);
    });

    it("supports include and exclude patterns", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
        include: ["pages/**", "app/**"],
        exclude: ["**/*.test.ts"],
      };
      assertEquals(options.include, ["pages/**", "app/**"]);
      assertEquals(options.exclude, ["**/*.test.ts"]);
    });
  });

  describe("re-export via index.ts", () => {
    it("buildCommand is available from index", async () => {
      const mod = await import("./index.ts");
      assertExists(mod.buildCommand);
      assertEquals(typeof mod.buildCommand, "function");
    });

    it("handleBuildCommand is available from index", async () => {
      const mod = await import("./index.ts");
      assertExists(mod.handleBuildCommand);
      assertEquals(typeof mod.handleBuildCommand, "function");
    });
  });
});

describe("cli/build resolveBuildOutputDir clearsOutputDir", () => {
  // Raised in review on #3781. The guard exists because the production build
  // removes its output directory first. The embedded preset only mkdir's and
  // writes, so applying the guard there rejected `-o .` — a plausible call for
  // a preset meant to be embedded in a host project — over a hazard that does
  // not exist on that path.
  it("rejects an output directory containing the project when the caller clears it", () => {
    assertThrows(
      () => resolveBuildOutputDir("/tmp/proj", "/tmp/proj", { build: {} }),
      Error,
    );
  });

  it("allows the same directory when the caller only writes into it", () => {
    assertEquals(
      resolveBuildOutputDir("/tmp/proj", "/tmp/proj", { build: {} }, {
        clearsOutputDir: false,
      }),
      "/tmp/proj",
    );
  });

  it("still honours build.outDir when the guard is opted out", () => {
    assertEquals(
      resolveBuildOutputDir("/tmp/proj", undefined, { build: { outDir: "custom" } }, {
        clearsOutputDir: false,
      }),
      "/tmp/proj/custom",
    );
  });

  it("allows an external embedded build.outDir when the guard is opted out", () => {
    assertEquals(
      resolveBuildOutputDir(
        "/tmp/proj",
        undefined,
        { build: { outDir: "../host/dist" } },
        { clearsOutputDir: false },
      ),
      "/tmp/host/dist",
    );
  });
});
