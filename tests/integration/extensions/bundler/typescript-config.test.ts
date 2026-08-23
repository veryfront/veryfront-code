import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { makeTempDir, mkdir, readTextFile, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { VeryfrontError } from "#veryfront/errors";
import { readTypeScriptDecoratorOptions } from "veryfront/extensions/bundler";

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

  it("resolves dotted local extends names with the TypeScript JSON fallback", async () => {
    const workspaceDir = await makeTempDir();
    const projectDir = join(workspaceDir, "app");
    try {
      await mkdir(projectDir, { recursive: true });
      await writeTextFile(
        join(workspaceDir, "tsconfig.base.json"),
        JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
      );
      await writeTextFile(
        join(projectDir, "tsconfig.json"),
        JSON.stringify({ extends: "../tsconfig.base" }),
      );

      assertEquals(
        await readTypeScriptDecoratorOptions({
          configPath: join(projectDir, "tsconfig.json"),
        }),
        { experimentalDecorators: true, emitDecoratorMetadata: false },
      );
    } finally {
      await remove(workspaceDir, { recursive: true });
    }
  });

  it("resolves package extends through the project dependency tree", async () => {
    const workspaceDir = await makeTempDir();
    const projectDir = join(workspaceDir, "app");
    const packageDir = join(workspaceDir, "node_modules", "@fixture", "tsconfig");
    try {
      await mkdir(projectDir, { recursive: true });
      await mkdir(packageDir, { recursive: true });
      await writeTextFile(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "@fixture/tsconfig", main: "tsconfig.json" }),
      );
      await writeTextFile(
        join(packageDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { emitDecoratorMetadata: true } }),
      );
      await writeTextFile(
        join(projectDir, "tsconfig.json"),
        JSON.stringify({ extends: "@fixture/tsconfig" }),
      );

      assertEquals(
        await readTypeScriptDecoratorOptions({
          configPath: join(projectDir, "tsconfig.json"),
        }),
        { experimentalDecorators: false, emitDecoratorMetadata: true },
      );
    } finally {
      await remove(workspaceDir, { recursive: true });
    }
  });

  it("uses registered errors for inheritance cycles and depth", async () => {
    const cycleFiles = new Map([
      ["/project/tsconfig.json", JSON.stringify({ extends: "./base.json" })],
      ["/project/base.json", JSON.stringify({ extends: "./tsconfig.json" })],
    ]);
    const readTextFile = (path: string): Promise<string> => {
      const source = cycleFiles.get(path);
      return source === undefined
        ? Promise.reject(new Error(`missing ${path}`))
        : Promise.resolve(source);
    };
    const resolveExtends = (specifier: string, fromPath: string): Promise<string> => {
      const base = fromPath.slice(0, fromPath.lastIndexOf("/") + 1);
      return Promise.resolve(`${base}${specifier.replace(/^\.\//, "")}`);
    };
    const cycle = await assertRejects(
      () =>
        readTypeScriptDecoratorOptions({
          configPath: "/project/tsconfig.json",
          readTextFile,
          resolveExtends,
        }),
      VeryfrontError,
    );
    assertInstanceOf(cycle, VeryfrontError);
    assertEquals(cycle.slug, "tsconfig-inheritance-cycle");
    assertEquals(cycle.message.includes("/project/"), false);

    const depth = await assertRejects(
      () =>
        readTypeScriptDecoratorOptions({
          configPath: "/project/0.json",
          readTextFile: (path) => {
            const index = Number(path.match(/(\d+)\.json$/)?.[1]);
            return Promise.resolve(JSON.stringify({ extends: `./${index + 1}.json` }));
          },
          resolveExtends,
        }),
      VeryfrontError,
    );
    assertInstanceOf(depth, VeryfrontError);
    assertEquals(depth.slug, "tsconfig-inheritance-too-deep");
    assertEquals(depth.message.includes("/project/"), false);
  });

  it("sanitizes malformed configuration diagnostics", async () => {
    const error = await assertRejects(
      () =>
        readTypeScriptDecoratorOptions({
          configPath: "/project/private/tsconfig.json",
          readTextFile: () => Promise.resolve("{"),
        }),
      VeryfrontError,
    );

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "extension-manifest-parse-failed");
    assertEquals(error.message.includes("/project/private"), false);
    assertEquals(JSON.stringify(error.context).includes("/project/private"), false);
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
      const error = await assertRejects(
        () =>
          readTypeScriptDecoratorOptions({
            configPath: join(projectDir, "tsconfig.json"),
            readTextFile,
          }),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "tsconfig-read-failed");
      assertEquals(error.message.includes(projectDir), false);
      assertEquals(error.detail?.includes(projectDir) ?? false, false);
      assertEquals(JSON.stringify(error.context ?? {}).includes(projectDir), false);
      assertEquals(String(error.cause).includes(projectDir), false);
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("preserves path-free diagnostics from a caller-owned bounded reader", async () => {
    const error = await assertRejects(
      () =>
        readTypeScriptDecoratorOptions({
          configPath: "/project/tsconfig.json",
          readTextFile: (path) => {
            if (path === "/project/tsconfig.json") {
              return Promise.resolve(JSON.stringify({ extends: "./base.json" }));
            }
            return Promise.reject(
              new TypeError("TypeScript configuration exceeds 1048576 bytes"),
            );
          },
          resolveExtends: (specifier, fromPath) => {
            const base = fromPath.slice(0, fromPath.lastIndexOf("/") + 1);
            return Promise.resolve(`${base}${specifier.replace(/^\.\//, "")}`);
          },
        }),
      TypeError,
      "exceeds 1048576 bytes",
    );
    assertInstanceOf(error, TypeError);
  });

  it("sanitizes unresolved package extends diagnostics", async () => {
    const projectDir = await makeTempDir();
    try {
      await writeTextFile(
        join(projectDir, "tsconfig.json"),
        JSON.stringify({ extends: "@fixture/missing-tsconfig" }),
      );

      const error = await assertRejects(
        () =>
          readTypeScriptDecoratorOptions({
            configPath: join(projectDir, "tsconfig.json"),
          }),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "tsconfig-extends-resolution-failed");
      assertEquals(error.message.includes(projectDir), false);
      assertEquals(error.detail?.includes(projectDir) ?? false, false);
      assertEquals(JSON.stringify(error.context ?? {}).includes(projectDir), false);
      assertEquals(String(error.cause).includes(projectDir), false);
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("preserves path-free diagnostics from a caller-owned extends resolver", async () => {
    const error = await assertRejects(
      () =>
        readTypeScriptDecoratorOptions({
          configPath: "/project/tsconfig.json",
          readTextFile: () => Promise.resolve(JSON.stringify({ extends: "virtual-config" })),
          resolveExtends: () =>
            Promise.reject(new TypeError("Configured TypeScript base is unavailable")),
        }),
      TypeError,
      "Configured TypeScript base is unavailable",
    );
    assertInstanceOf(error, TypeError);
  });
});
