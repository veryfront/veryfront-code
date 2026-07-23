import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/pipeline/index.test */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { symlink } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import * as esbuild from "veryfront/extensions/bundler";
import { runPipeline, TransformStage, transformToESM } from "./index.ts";

describe(
  "transformToESM readFile routing",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    afterAll(async () => {
      await esbuild.stop();
    });

    it("does not hash or cache file dependencies outside projectDir", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-proj-" });
      const externalDir = await makeTempDir({ prefix: "vf-pipeline-ext-" });
      const mainFile = join(projectDir, "main.tsx");
      const externalFile = join(externalDir, "dep.ts");

      try {
        const mainSource = `import { dep } from "file://${externalFile}";
export default function App() { return dep; }`;

        await writeTextFile(mainFile, mainSource);
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

        const result = await runPipeline(mainSource, mainFile, projectDir, {
          ssr: true,
          dev: true,
          projectId: "test-project",
          readFile: adapter.fs.readFile,
        });

        assertEquals(result.cached, false);
        assertEquals(readCalls.includes(externalFile), false);
      } finally {
        await remove(projectDir, { recursive: true });
        await remove(externalDir, { recursive: true });
      }
    });

    it("disables transform caching when dependency hashing fails", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-hash-proj-" });
      const mainFile = join(projectDir, "main.ts");

      try {
        const options = {
          ssr: false,
          dev: true,
          projectId: "hash-failure-project",
          readFile: () => Promise.reject(new Error("sensitive backend detail")),
        };
        const source = "export const value = 1;";

        const first = await runPipeline(source, mainFile, projectDir, options);
        const second = await runPipeline(source, mainFile, projectDir, options);

        assertEquals(first.cached, false);
        assertEquals(second.cached, false);
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });

    it("transforms valid TSX without caching when the dependency lexer cannot parse it", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-tsx-proj-" });
      const mainFile = join(projectDir, "main.tsx");
      const source = "export default function Page() { return <main>ok</main>; }";

      try {
        const result = await runPipeline(source, mainFile, projectDir, {
          ssr: false,
          dev: true,
          projectId: "tsx-parse-project",
          readFile: () => Promise.resolve(source),
        });

        assertEquals(result.cached, false);
        assertEquals(result.code.includes("main"), true);
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });

    it("rejects dependency paths that escape through a symlink", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-link-proj-" });
      const externalDir = await makeTempDir({ prefix: "vf-pipeline-link-ext-" });
      const mainFile = join(projectDir, "main.ts");
      const externalFile = join(externalDir, "dep.ts");
      const dependencyLink = join(projectDir, "dep.ts");

      try {
        const mainSource = 'import { dep } from "./dep.ts"; export const value = dep;';
        await writeTextFile(mainFile, mainSource);
        await writeTextFile(join(projectDir, "dep.js"), "export const dep = 0;");
        await writeTextFile(externalFile, "export const dep = 1;");
        await symlink(externalFile, dependencyLink);

        const error = await assertRejects(
          () =>
            transformToESM(mainSource, mainFile, projectDir, null, {
              ssr: false,
              dev: true,
              projectId: "symlink-escape-project",
            }),
          Error,
        );

        assertEquals(error.message.includes(projectDir), false);
        assertEquals(error.message.includes(externalDir), false);
      } finally {
        await remove(projectDir, { recursive: true });
        await remove(externalDir, { recursive: true });
      }
    });

    it("does not reuse cached output across custom plugin configurations", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-pipeline-plugin-cache-" });
      const mainFile = join(projectDir, "main.ts");
      const source = "export const value = 1;";
      const options = { projectId: "plugin-cache-project", ssr: false };
      let firstPluginRuns = 0;
      let secondPluginRuns = 0;

      try {
        const first = await runPipeline(source, mainFile, projectDir, options, {
          plugins: [{
            name: "first-custom-plugin",
            stage: TransformStage.FINALIZE,
            transform: (ctx) => {
              firstPluginRuns++;
              return `${ctx.code}\n// first-plugin`;
            },
          }],
        });
        const second = await runPipeline(source, mainFile, projectDir, options, {
          plugins: [{
            name: "second-custom-plugin",
            stage: TransformStage.FINALIZE,
            transform: (ctx) => {
              secondPluginRuns++;
              return `${ctx.code}\n// second-plugin`;
            },
          }],
        });

        assertEquals(first.cached, false);
        assertEquals(second.cached, false);
        assertEquals(firstPluginRuns, 1);
        assertEquals(secondPluginRuns, 1);
        assertEquals(second.code.includes("second-plugin"), true);
        assertEquals(second.code.includes("first-plugin"), false);
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });
  },
);
