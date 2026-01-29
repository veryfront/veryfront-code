/** @module transforms/pipeline/index.test */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { join } from "#std/path.ts";
import { transformToESM } from "./index.ts";

describe("transformToESM readFile routing", () => {
  it("uses local fs for file:// deps outside projectDir", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-pipeline-proj-" });
    const externalDir = await makeTempDir({ prefix: "vf-pipeline-ext-" });
    const mainFile = join(projectDir, "main.tsx");
    const externalFile = join(externalDir, "dep.ts");

    try {
      const mainSource = [
        `import { dep } from "file://${externalFile}";`,
        `export default function App() { return dep; }`,
      ].join("\n");
      await writeTextFile(mainFile, mainSource);
      await writeTextFile(externalFile, `export const dep = 1;`);

      const readCalls: string[] = [];
      const adapter = {
        fs: {
          readFile: async (path: string): Promise<string> => {
            readCalls.push(path);
            if (path === externalFile) {
              throw new Error("Adapter should not read external file:// dependency");
            }
            return await readTextFile(path);
          },
        },
      };

      await transformToESM(
        mainSource,
        mainFile,
        projectDir,
        adapter,
        { ssr: true, dev: true, projectId: "test-project" },
      );

      assertEquals(readCalls.includes(externalFile), false);
    } finally {
      await remove(projectDir, { recursive: true });
      await remove(externalDir, { recursive: true });
    }
  });
});
