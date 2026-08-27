import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { ESM_CACHE_INIT_FAILED, VeryfrontError } from "#veryfront/errors";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { ensureCachedVeryfrontEsmPackageScope } from "#veryfront/modules/react-loader/ssr-module-loader/esm-package-scope.ts";

describe("cached Veryfront ESM package scope intrinsics", () => {
  it("revalidates after project code poisons parsing primordials", async () => {
    const tmpDir = await makeTempDir({ prefix: "vf-ssr-package-scope-intrinsics-" });
    const fs = createFileSystem();

    try {
      await ensureCachedVeryfrontEsmPackageScope(fs, tmpDir);

      const jsonParse = Object.getOwnPropertyDescriptor(JSON, "parse")!;
      const objectHasOwn = Object.getOwnPropertyDescriptor(Object, "hasOwn")!;
      const objectKeys = Object.getOwnPropertyDescriptor(Object, "keys")!;
      const textDecoder = Object.getOwnPropertyDescriptor(globalThis, "TextDecoder")!;
      const decoderPrototype = TextDecoder.prototype;
      const decoderDecode = Object.getOwnPropertyDescriptor(decoderPrototype, "decode")!;
      let failure: unknown;
      let conflictFailure: unknown;
      try {
        const poisoned = () => {
          throw new Error("ambient intrinsic must not be used");
        };
        Object.defineProperty(JSON, "parse", {
          ...jsonParse,
          value: () => ({ private: true, type: "module" }),
        });
        Object.defineProperty(Object, "hasOwn", { ...objectHasOwn, value: poisoned });
        Object.defineProperty(Object, "keys", { ...objectKeys, value: poisoned });
        Object.defineProperty(decoderPrototype, "decode", {
          ...decoderDecode,
          value: poisoned,
        });
        Object.defineProperty(globalThis, "TextDecoder", {
          ...textDecoder,
          value: class {
            constructor() {
              throw new Error("ambient TextDecoder must not be used");
            }
          },
        });
        try {
          await ensureCachedVeryfrontEsmPackageScope(fs, tmpDir);
        } catch (error) {
          failure = error;
        }
        if (failure === undefined) {
          await fs.writeTextFile(
            join(tmpDir, "node_modules", "veryfront", "esm", "package.json"),
            '{"private":false,"type":"commonjs"}\n',
          );
          try {
            await ensureCachedVeryfrontEsmPackageScope(fs, tmpDir);
          } catch (error) {
            conflictFailure = error;
          }
        }
      } finally {
        Object.defineProperty(JSON, "parse", jsonParse);
        Object.defineProperty(Object, "hasOwn", objectHasOwn);
        Object.defineProperty(Object, "keys", objectKeys);
        Object.defineProperty(decoderPrototype, "decode", decoderDecode);
        Object.defineProperty(globalThis, "TextDecoder", textDecoder);
      }
      if (failure !== undefined) throw failure;
      assertInstanceOf(conflictFailure, VeryfrontError);
      assertEquals(conflictFailure.slug, ESM_CACHE_INIT_FAILED.slug);
    } finally {
      await remove(tmpDir, { recursive: true });
    }
  });
});
