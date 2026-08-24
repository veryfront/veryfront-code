import "#veryfront/schemas/_test-setup.ts";

// Relocated from the colocated unit test: createStubModule writes through the
// process-wide local FileSystem singleton, so these cases need a real cache
// directory on disk.

import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, readTextFile, remove } from "#veryfront/testing/deno-compat.ts";
import { toFileUrl } from "#veryfront/compat/path";
import { createStubModule } from "#veryfront/transforms/mdx/esm-module-loader/utils/stub-module.ts";

describe("createStubModule", () => {
  it("writes a fail-on-import stub that throws the deferred error", async () => {
    const esmCacheDir = await makeTempDir({ prefix: "vf-stub-module-strict-" });

    try {
      const stubPath = await createStubModule(
        "./missing.js",
        `const load = () => import("./missing.js");`,
        `import("./missing.js")`,
        esmCacheDir,
        {
          failOnImport: true,
          deferredError: { name: "MissingModuleError", message: "boom" },
        },
      );
      assertEquals(typeof stubPath, "string", "a fail-on-import stub must be written");

      const stubCode = await readTextFile(stubPath!);
      assertStringIncludes(
        stubCode,
        `error.name = "MissingModuleError"`,
        "the stub must carry the deferred error name",
      );
      assertStringIncludes(stubCode, `"boom"`, "the stub must carry the deferred error message");

      const error = await assertRejects(
        () => import(`${toFileUrl(stubPath!).href}?test=${crypto.randomUUID()}`),
        Error,
        "boom",
      ) as Error;
      assertEquals(
        error.name,
        "MissingModuleError",
        "importing a fail-on-import stub must throw the deferred error",
      );
    } finally {
      await remove(esmCacheDir, { recursive: true });
    }
  });

  it("writes a permissive fallback stub when failOnImport is omitted", async () => {
    const esmCacheDir = await makeTempDir({ prefix: "vf-stub-module-fallback-" });

    try {
      const stubPath = await createStubModule(
        "./missing.js",
        `import { foo } from "./missing.js";`,
        `from "./missing.js"`,
        esmCacheDir,
      );
      assertEquals(typeof stubPath, "string", "a fallback stub must be written");

      const stubCode = await readTextFile(stubPath!);
      assertStringIncludes(
        stubCode,
        "export default new Proxy",
        "the fallback stub must export a proxy default",
      );
      assertStringIncludes(
        stubCode,
        "export const foo",
        "the fallback stub must re-export the named imports",
      );
    } finally {
      await remove(esmCacheDir, { recursive: true });
    }
  });

  it("keeps fail-on-import and fallback stubs in separate cache files", async () => {
    const esmCacheDir = await makeTempDir({ prefix: "vf-stub-module-collision-" });
    const modulePath = "./missing.js";
    const code = `import { foo } from "./missing.js";`;
    const importStatement = `from "./missing.js"`;

    try {
      const strictPath = await createStubModule(modulePath, code, importStatement, esmCacheDir, {
        failOnImport: true,
        deferredError: { name: "MissingModuleError", message: "boom" },
      });
      const fallbackPath = await createStubModule(modulePath, code, importStatement, esmCacheDir);

      assertNotEquals(
        strictPath,
        fallbackPath,
        "fail-on-import and fallback stubs must not share a cache file",
      );
      assertNotEquals(
        await readTextFile(strictPath!),
        await readTextFile(fallbackPath!),
        "the two stub variants must keep their distinct bodies",
      );
    } finally {
      await remove(esmCacheDir, { recursive: true });
    }
  });
});
