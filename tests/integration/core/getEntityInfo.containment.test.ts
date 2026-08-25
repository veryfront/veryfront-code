import { assertEquals } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat";
import { getEntityBySlug, getLayoutEntity } from "../../../src/types/entities/getEntityInfo.ts";

describe("getEntityBySlug containment", () => {
  it("does not resolve slugs outside the pages directory", async () => {
    await withTempDir(async (root) => {
      const projectDir = join(root, "project");
      await mkdir(join(projectDir, "pages"), { recursive: true });
      await writeTextFile(join(root, "outside.mdx"), "# Outside");

      assertEquals(await getEntityBySlug(projectDir, "../../outside"), null);
      assertEquals(await getEntityBySlug(projectDir, "./../../outside"), null);
      assertEquals(await getEntityBySlug(projectDir, "..\\..\\outside"), null);
    });
  });

  it("rejects pages directories that escape the project", async () => {
    await withTempDir(async (root) => {
      const projectDir = join(root, "project");
      await mkdir(join(projectDir, "pages"), { recursive: true });
      await mkdir(join(root, "outside"), { recursive: true });
      await writeTextFile(join(root, "outside", "secret.mdx"), "# Outside");

      assertEquals(
        await getEntityBySlug(projectDir, "secret", undefined, "../outside"),
        null,
      );
      assertEquals(
        await getEntityBySlug(
          projectDir,
          "secret",
          undefined,
          join(root, "outside"),
        ),
        null,
      );
    });
  });

  it("rejects page files and directories that escape through symlinks", async () => {
    await withTempDir(async (root) => {
      const projectDir = join(root, "project");
      const pagesDir = join(projectDir, "pages");
      const outsideDir = join(root, "outside");
      await mkdir(pagesDir, { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      await writeTextFile(join(outsideDir, "secret.mdx"), "# Secret");
      await writeTextFile(join(outsideDir, "index.mdx"), "# Secret index");
      await Deno.symlink(join(outsideDir, "secret.mdx"), join(pagesDir, "leak.mdx"), {
        type: "file",
      });
      await Deno.symlink(outsideDir, join(pagesDir, "linked"), { type: "dir" });

      assertEquals(await getEntityBySlug(projectDir, "leak"), null);
      assertEquals(await getEntityBySlug(projectDir, "linked"), null);
    });
  });

  it("still resolves ordinary slugs inside the pages directory", async () => {
    await withTempDir(async (root) => {
      const projectDir = join(root, "project");
      await mkdir(join(projectDir, "pages"), { recursive: true });
      await writeTextFile(join(projectDir, "pages", "about.mdx"), "# About");

      const result = await getEntityBySlug(projectDir, "about");

      assertEquals(result?.entity.content, "# About");
    });
  });
});

describe("getLayoutEntity containment", () => {
  it("does not resolve layouts outside the project", async () => {
    await withTempDir(async (root) => {
      const projectDir = join(root, "project");
      await mkdir(join(projectDir, "layouts"), { recursive: true });
      await writeTextFile(
        join(root, "outside.mdx"),
        "---\nisLayout: true\n---\n# Outside layout",
      );

      assertEquals(await getLayoutEntity(projectDir, "../outside.mdx"), null);
      assertEquals(await getLayoutEntity(projectDir, "@/../outside.mdx"), null);
      assertEquals(
        await getLayoutEntity(projectDir, join(root, "outside.mdx")),
        null,
      );
    });
  });

  it("still resolves ordinary layouts inside the project", async () => {
    await withTempDir(async (root) => {
      const projectDir = join(root, "project");
      await mkdir(join(projectDir, "layouts"), { recursive: true });
      await writeTextFile(
        join(projectDir, "layouts", "main.mdx"),
        "# Main layout",
      );

      const result = await getLayoutEntity(projectDir, "main");

      assertEquals(result?.entity.content, "# Main layout");
    });
  });

  it("rejects layout files that escape through symlinks", async () => {
    await withTempDir(async (root) => {
      const projectDir = join(root, "project");
      const layoutsDir = join(projectDir, "layouts");
      const outsideLayout = join(root, "outside.mdx");
      await mkdir(layoutsDir, { recursive: true });
      await writeTextFile(outsideLayout, "# Outside layout");
      await Deno.symlink(outsideLayout, join(layoutsDir, "main.mdx"), { type: "file" });

      assertEquals(await getLayoutEntity(projectDir, "main"), null);
      assertEquals(await getLayoutEntity(projectDir, "layouts/main.mdx"), null);
    });
  });
});
