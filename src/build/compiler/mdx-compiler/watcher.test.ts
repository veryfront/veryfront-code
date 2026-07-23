import "#veryfront/schemas/_test-setup.ts";
import { assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { watchMDX } from "./watcher.ts";

describe(
  "build/compiler/mdx-compiler/watcher",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it("returns when no configured source directory exists", async () => {
      const projectDir = await Deno.makeTempDir();
      try {
        await watchMDX({
          projectDir,
          outputDir: `${projectDir}/output`,
          mode: "development",
          sourceDirectories: ["content"],
        });
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects a configured source path that is not a directory", async () => {
      const projectDir = await Deno.makeTempDir();
      try {
        await Deno.writeTextFile(`${projectDir}/content`, "not a directory");
        await assertRejects(
          () =>
            watchMDX({
              projectDir,
              outputDir: `${projectDir}/output`,
              mode: "development",
              sourceDirectories: ["content"],
            }),
          TypeError,
          "source paths must be directories",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("closes immediately when its signal is already aborted", async () => {
      const projectDir = await Deno.makeTempDir();
      const controller = new AbortController();
      controller.abort();
      try {
        await Deno.mkdir(`${projectDir}/content`);
        await watchMDX({
          projectDir,
          outputDir: `${projectDir}/output`,
          mode: "development",
          sourceDirectories: ["content"],
          signal: controller.signal,
        });
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  },
);
