/**
 * Scaffold parity gate.
 *
 * veryfront-issue-inbox #475: a project created outside the CLI must be
 * byte-identical to one `veryfront init` creates from the same template.
 * Nothing enforced that, because the hosted flow copied its own stored
 * starter project instead of reading this repository's templates — so it
 * froze at an older era while the CLI templates moved on.
 *
 * `veryfront/scaffold` is the artifact that closes it: one materializer, two
 * consumers. These tests assert the agreement by construction — the CLI's
 * on-disk output is compared against what `materializeScaffold` returns for
 * the same request, so any future template, generator or alias change is
 * covered without a snapshot to update.
 *
 * @module templates/scaffold-parity.test
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { walk } from "#std/fs.ts";
import { readTextFile } from "#veryfront/testing/deno-compat.ts";
import {
  createProject,
  listScaffoldTemplates,
  materializeScaffold,
  resolveScaffoldTemplate,
} from "../cli/shared/project-creation.ts";
import { STARTER_TEMPLATE_NAMES } from "./types.ts";
import type { InitTemplate } from "../cli/commands/init/types.ts";

const PROJECT_NAME = "parity-app";

/** Read a scaffolded project back off disk as `path -> content`. */
async function readProject(projectDir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const entry of walk(projectDir, { includeDirs: false })) {
    const relative = entry.path.slice(projectDir.length + 1).replaceAll("\\", "/");
    files.set(relative, await readTextFile(entry.path));
  }
  return files;
}

/**
 * Index the returned files by path.
 *
 * A `Map` would quietly collapse a path emitted twice, and a caller writing
 * the array in order would end up with whichever copy came last, so the
 * duplicate is rejected here rather than hidden.
 */
function materializedFiles(files: { path: string; content: string }[]): Map<string, string> {
  const byPath = new Map<string, string>();
  for (const file of files) {
    assertEquals(
      byPath.has(file.path),
      false,
      `materializeScaffold returned "${file.path}" more than once`,
    );
    byPath.set(file.path, file.content);
  }
  return byPath;
}

describe("scaffold parity", () => {
  for (const template of STARTER_TEMPLATE_NAMES) {
    it(`materializes exactly what \`veryfront init\` writes: ${template}`, async () => {
      const parentDir = await makeTempDir({ prefix: `veryfront-parity-${template}-` });
      try {
        await createProject({
          name: PROJECT_NAME,
          parentDir,
          template: template as InitTemplate,
          runtime: "node",
          features: [],
          integrations: [],
          environmentValues: {},
          conflictPolicy: "fail",
          installDependencies: false,
          initializeGit: false,
          includePackageMetadata: true,
        });

        const written = await readProject(join(parentDir, PROJECT_NAME));
        const materialized = materializedFiles(
          (await materializeScaffold({ template, projectName: PROJECT_NAME })).files,
        );

        assertEquals(
          [...materialized.keys()].sort(),
          [...written.keys()].sort(),
          `${template}: materialized file list must match what the CLI wrote`,
        );
        for (const [path, content] of written) {
          assertEquals(
            materialized.get(path),
            content,
            `${template}: ${path} must be byte-identical between the CLI and the materializer`,
          );
        }
      } finally {
        await remove(parentDir, { recursive: true }).catch(() => {});
      }
    });
  }

  it("writes deno.json only for the deno runtime, on both paths", async () => {
    const node = await materializeScaffold({ template: "minimal", projectName: PROJECT_NAME });
    const deno = await materializeScaffold({
      template: "minimal",
      projectName: PROJECT_NAME,
      runtime: "deno",
    });

    assertEquals(node.files.some((file) => file.path === "deno.json"), false);
    assertEquals(deno.files.some((file) => file.path === "deno.json"), true);
  });

  describe("template vocabulary", () => {
    it("resolves the hosted 'blank' slug to the CLI's minimal starter", () => {
      assertEquals(resolveScaffoldTemplate("blank"), "minimal");
    });

    it("materializes 'blank' and 'minimal' as the same project", async () => {
      const blank = await materializeScaffold({ template: "blank", projectName: PROJECT_NAME });
      const minimal = await materializeScaffold({
        template: "minimal",
        projectName: PROJECT_NAME,
      });

      assertEquals(blank.template, minimal.template);
      assertEquals(blank.files, minimal.files);
    });

    it("resolves every advertised slug", () => {
      for (const slug of listScaffoldTemplates()) {
        assertEquals(
          resolveScaffoldTemplate(slug) !== null,
          true,
          `advertised slug "${slug}" must resolve to a template`,
        );
      }
    });

    it("rejects an unknown slug instead of scaffolding something else", async () => {
      assertEquals(resolveScaffoldTemplate("nope"), null);
      await assertRejects(() => materializeScaffold({ template: "nope" }));
    });

    it("rejects a project name the CLI would reject", async () => {
      for (const name of ["", "   ", "../escape", "nested/name", ".."]) {
        await assertRejects(
          () => materializeScaffold({ template: "minimal", projectName: name }),
          undefined,
          undefined,
          `"${name}" must be rejected here as well as by \`veryfront init\``,
        );
      }
    });
  });
});
