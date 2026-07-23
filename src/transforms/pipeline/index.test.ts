import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/pipeline/index.test */

import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { join, toFileUrl } from "#veryfront/compat/path";
import { computeDependencyCacheIdentity } from "./dependency-cache-identity.ts";
import { createPipelineReadFile } from "./read-file.ts";

describe(
  "transform pipeline dependency identity",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    it("uses local fs for file:// deps outside projectDir", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-proj-" });
      const externalDir = await makeTempDir({ prefix: "vf-pipeline-ext-" });
      const mainFile = join(projectDir, "main.tsx");
      const externalFile = join(externalDir, "dep.ts");

      try {
        await writeTextFile(mainFile, "export default true;");
        await writeTextFile(externalFile, "export const dep = 1;");

        const readCalls: string[] = [];
        const adapter = {
          fs: {
            readFile: async (path: string): Promise<string> => {
              readCalls.push(path);
              if (path === externalFile) {
                throw new Error(
                  "Adapter should not read external file:// dependency",
                );
              }
              return await readTextFile(path);
            },
          },
        };

        const readFile = createPipelineReadFile(adapter, projectDir);

        assertEquals(await readFile(toFileUrl(externalFile).href), "export const dep = 1;");
        assertEquals(readCalls.includes(externalFile), false);
      } finally {
        await remove(projectDir, { recursive: true });
        await remove(externalDir, { recursive: true });
      }
    });

    it("does not route sibling-prefix paths through the project adapter", async () => {
      const tempDir = await makeTempDir({ prefix: "vf-pipeline-boundary-" });
      const projectDir = join(tempDir, "project");
      const siblingDir = join(tempDir, "project-evil");
      const siblingFile = join(siblingDir, "entry.ts");
      const source = "export const sibling = true;";

      try {
        await mkdir(projectDir, { recursive: true });
        await mkdir(siblingDir, { recursive: true });
        await writeTextFile(siblingFile, source);

        const adapterReads: string[] = [];
        const adapter = {
          fs: {
            readFile: (path: string): Promise<string> => {
              adapterReads.push(path);
              return Promise.reject(new Error("Sibling path escaped project boundary"));
            },
          },
        };

        for (
          const [filePath, configuredProjectDir] of [
            [siblingFile, projectDir],
            [toFileUrl(siblingFile).href, `${projectDir}/`],
          ] as const
        ) {
          const readFile = createPipelineReadFile(adapter, configuredProjectDir);
          assertEquals(await readFile(filePath), source);
        }

        assertEquals(adapterReads, []);
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });

    it("routes project paths through the adapter with or without a trailing slash", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-inside-" });
      const mainFile = join(projectDir, "entry file.ts");
      const source = "export const local = true;";

      try {
        await writeTextFile(mainFile, source);

        const adapterReads: string[] = [];
        const adapter = {
          fs: {
            readFile: (path: string): Promise<string> => {
              adapterReads.push(path);
              return readTextFile(path);
            },
          },
        };

        assertEquals(await createPipelineReadFile(adapter, projectDir)(mainFile), source);
        assertEquals(
          await createPipelineReadFile(adapter, `${projectDir}/`)(toFileUrl(mainFile).href),
          source,
        );

        assertEquals(adapterReads, [mainFile, mainFile]);
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });

    it("marks a transform uncacheable when dependency identity cannot be computed", async () => {
      const sourceError = new Error("source store unavailable");
      const identity = await computeDependencyCacheIdentity(
        "/project/pages/index.ts",
        "/project",
        () => Promise.reject(sourceError),
      );

      assertEquals(identity.cacheable, false);
      if (identity.cacheable) throw new Error("Expected an uncacheable dependency identity");
      if (!(identity.error instanceof Error)) throw new Error("Expected dependency error context");
      assertStringIncludes(identity.error.message, "could not read /project/pages/index.ts");
      assertStrictEquals(identity.error.cause, sourceError);
    });
  },
);
