import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";
import {
  clearProjectLink,
  type ProjectLink,
  readProjectLink,
  writeProjectLink,
} from "./project-link.ts";

const LINK: Omit<ProjectLink, "version"> = {
  controlPlane: "https://api.veryfront.com/control-plane/",
  projectId: "550e8400-e29b-41d4-a716-446655440000",
  projectSlug: "veryfront-ops-agent",
};

async function withTempProject(
  fn: (projectDir: string) => Promise<void>,
): Promise<void> {
  const projectDir = await Deno.makeTempDir();
  try {
    await fn(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

async function writeRawProjectLink(projectDir: string, value: unknown): Promise<void> {
  await Deno.mkdir(join(projectDir, ".veryfront"), { recursive: true });
  const content = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  await Deno.writeTextFile(join(projectDir, ".veryfront", "project.json"), content);
}

describe("project link persistence", () => {
  it("round-trips a normalized project link in the ignored Veryfront directory", async () => {
    await withTempProject(async (projectDir) => {
      const written = await writeProjectLink(projectDir, LINK);

      assertEquals(written, {
        version: 1,
        ...LINK,
        controlPlane: "https://api.veryfront.com/control-plane",
      });
      assertEquals(await readProjectLink(projectDir), written);
    });
  });

  it("returns null for a malformed project link file", async () => {
    await withTempProject(async (projectDir) => {
      await writeRawProjectLink(projectDir, "{not json");

      assertEquals(await readProjectLink(projectDir), null);
    });
  });

  it("returns null for an unsupported project link version", async () => {
    await withTempProject(async (projectDir) => {
      await writeRawProjectLink(projectDir, {
        version: 2,
        controlPlane: "https://api.veryfront.com",
        projectId: LINK.projectId,
        projectSlug: LINK.projectSlug,
      });

      assertEquals(await readProjectLink(projectDir), null);
    });
  });

  it("returns null for a missing project link file", async () => {
    await withTempProject(async (projectDir) => {
      assertEquals(await readProjectLink(projectDir), null);
    });
  });

  it("rejects a symlinked Veryfront directory without touching its target", async () => {
    if (Deno.build.os === "windows") return;

    const projectDir = await Deno.makeTempDir();
    const externalDir = await Deno.makeTempDir();
    const externalProjectLink = join(externalDir, "project.json");
    try {
      await Deno.writeTextFile(externalProjectLink, "sentinel\n");
      await Deno.symlink(externalDir, join(projectDir, ".veryfront"));

      for (
        const operation of [
          () => readProjectLink(projectDir),
          () => clearProjectLink(projectDir),
          () => writeProjectLink(projectDir, LINK),
        ]
      ) {
        await assertRejects(operation, Error, "through a symbolic link");
      }
      assertEquals(await Deno.readTextFile(externalProjectLink), "sentinel\n");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(externalDir, { recursive: true });
    }
  });

  it("rejects a symlinked project link file without touching its target", async () => {
    if (Deno.build.os === "windows") return;

    const projectDir = await Deno.makeTempDir();
    const externalDir = await Deno.makeTempDir();
    const externalProjectLink = join(externalDir, "project.json");
    try {
      await Deno.mkdir(join(projectDir, ".veryfront"));
      await Deno.writeTextFile(externalProjectLink, "sentinel\n");
      await Deno.symlink(externalProjectLink, join(projectDir, ".veryfront", "project.json"));

      for (
        const operation of [
          () => readProjectLink(projectDir),
          () => clearProjectLink(projectDir),
          () => writeProjectLink(projectDir, LINK),
        ]
      ) {
        await assertRejects(operation, Error, "Remove the link");
      }
      assertEquals(await Deno.readTextFile(externalProjectLink), "sentinel\n");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(externalDir, { recursive: true });
    }
  });

  it("atomically replaces an existing project link", async () => {
    await withTempProject(async (projectDir) => {
      await writeRawProjectLink(projectDir, {
        version: 1,
        controlPlane: "https://old.example.com",
        projectId: "old-project",
        projectSlug: "old-slug",
        staleField: true,
      });

      const written = await writeProjectLink(projectDir, LINK);

      assertEquals(await readProjectLink(projectDir), written);
      const entries = [];
      for await (const entry of Deno.readDir(join(projectDir, ".veryfront"))) {
        entries.push(entry.name);
      }
      assertEquals(entries.sort(), ["project.json"]);
    });
  });

  it("clears an existing project link", async () => {
    await withTempProject(async (projectDir) => {
      await writeProjectLink(projectDir, LINK);

      await clearProjectLink(projectDir);

      assertEquals(await readProjectLink(projectDir), null);
    });
  });
});
