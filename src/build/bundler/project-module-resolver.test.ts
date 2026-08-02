import { join } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getProjectModuleCandidates,
  resolveProjectModule,
  resolveProjectSourcePath,
} from "./project-module-resolver.ts";

describe("build/bundler/project-module-resolver", () => {
  it("resolves extensionless aliases and preserves query/fragment suffixes", async () => {
    const root = await Deno.makeTempDir();
    try {
      const projectDir = join(root, "project");
      const sourceDir = join(projectDir, "src");
      await Deno.mkdir(sourceDir, { recursive: true });
      const modulePath = join(sourceDir, "helper.ts");
      await Deno.writeTextFile(modulePath, "export const helper = true;");

      const resolved = await resolveProjectModule(
        "@/src/helper?client#preview",
        projectDir,
        projectDir,
        createFileSystem(),
        "Test",
      );

      assertEquals(resolved?.path, modulePath);
      assertEquals(resolved?.suffix, "?client#preview");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("distinguishes dot-prefixed filenames from parent traversal", async () => {
    const candidates = getProjectModuleCandidates(
      "./..component",
      "/project/src",
      "/project",
      "Test",
    );
    assertEquals(candidates?.paths[0], "/project/src/..component");

    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          getProjectModuleCandidates(
            "../../outside",
            "/project/src",
            "/project",
            "Test",
          )
        ),
      Error,
      "outside the project",
    );
  });

  it("rejects source paths outside the project or containing controls", async () => {
    await assertRejects(
      () =>
        Promise.resolve().then(() => resolveProjectSourcePath("../outside.ts", "/project", "Test")),
      Error,
      "outside the project",
    );
    await assertRejects(
      () =>
        Promise.resolve().then(() => resolveProjectSourcePath("bad\u0000.ts", "/project", "Test")),
      TypeError,
      "safe non-empty path",
    );
  });

  it("rejects a local import whose symlink target escapes the project", async () => {
    if (Deno.build.os === "windows") return;

    const root = await Deno.makeTempDir();
    try {
      const projectDir = join(root, "project");
      await Deno.mkdir(projectDir);
      const outsidePath = join(root, "outside.ts");
      await Deno.writeTextFile(outsidePath, "export default 1;");
      await Deno.symlink(outsidePath, join(projectDir, "linked.ts"));

      await assertRejects(
        () =>
          resolveProjectModule(
            "./linked.ts",
            projectDir,
            projectDir,
            createFileSystem(),
            "Test",
          ),
        Error,
        "symbolic link",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
