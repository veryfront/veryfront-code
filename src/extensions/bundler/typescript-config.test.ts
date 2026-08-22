import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
});
