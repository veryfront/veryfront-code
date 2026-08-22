import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { makeTempDir, readTextFile, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { readTypeScriptDecoratorOptions } from "./typescript-config.ts";

describe("readTypeScriptDecoratorOptions", () => {
  it("resolves inherited JSONC compiler flags with child overrides", async () => {
    const files = new Map<string, string>([
      [
        "/project/tsconfig.json",
        `{
          // Multiple inheritance follows TypeScript left-to-right precedence.
          "extends": ["./base.json", "./metadata.json"],
          "compilerOptions": { "experimentalDecorators": true }
        }`,
      ],
      [
        "/project/base.json",
        `{
          "compilerOptions": {
            "experimentalDecorators": false,
            "emitDecoratorMetadata": false
          }
        }`,
      ],
      [
        "/project/metadata.json",
        `{
          "extends": "./base.json",
          "compilerOptions": { "emitDecoratorMetadata": true }
        }`,
      ],
    ]);

    const result = await readTypeScriptDecoratorOptions({
      configPath: "/project/tsconfig.json",
      readTextFile: (path) => {
        const source = files.get(path);
        if (source === undefined) return Promise.reject(new Error(`missing ${path}`));
        return Promise.resolve(source);
      },
      resolveExtends: (specifier, fromPath) => {
        const base = fromPath.slice(0, fromPath.lastIndexOf("/") + 1);
        return Promise.resolve(`${base}${specifier.replace(/^\.\//, "")}`);
      },
    });

    assertEquals(result, {
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    });
  });

  it("fails closed when the root config is absent", async () => {
    assertEquals(
      await readTypeScriptDecoratorOptions({
        configPath: "/project/tsconfig.json",
        readTextFile: () => Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
      }),
      { experimentalDecorators: false, emitDecoratorMetadata: false },
    );
  });

  it("fails closed on the real missing-file error this runtime raises", async () => {
    // The API route loader supplies a reader backed by the host filesystem, so
    // a synthetic `{ code: "ENOENT" }` double proves nothing about production.
    // Read a path that genuinely does not exist and let the runtime throw.
    const projectDir = await makeTempDir();
    try {
      assertEquals(
        await readTypeScriptDecoratorOptions({
          configPath: join(projectDir, "tsconfig.json"),
          readTextFile,
        }),
        { experimentalDecorators: false, emitDecoratorMetadata: false },
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("fails closed on the default reader when no config exists", async () => {
    const projectDir = await makeTempDir();
    try {
      assertEquals(
        await readTypeScriptDecoratorOptions({
          configPath: join(projectDir, "tsconfig.json"),
        }),
        { experimentalDecorators: false, emitDecoratorMetadata: false },
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("surfaces an inherited config that is missing rather than failing closed", async () => {
    // Only the root config may be absent. A broken `extends` target is a real
    // configuration error and must not silently disable the transform.
    const projectDir = await makeTempDir();
    try {
      await writeTextFile(
        join(projectDir, "tsconfig.json"),
        JSON.stringify({ extends: "./absent.json" }),
      );
      await assertRejects(() =>
        readTypeScriptDecoratorOptions({
          configPath: join(projectDir, "tsconfig.json"),
          readTextFile,
        })
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });
});
