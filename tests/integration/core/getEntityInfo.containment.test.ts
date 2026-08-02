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
});
