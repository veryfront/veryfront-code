import type { ValidationError } from "npm:class-validator@0.15.1";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { cwd } from "#veryfront/compat/process.ts";
import type { BundlerPlugin } from "veryfront/extensions/bundler";
import { SwcBundler } from "@veryfront/ext-bundler-swc";

const METADATA_SOURCE = `
function decorate(..._args: unknown[]): void {}
function decorateClass(): ClassDecorator { return () => {}; }

export class Dependency {}

@decorateClass()
export class Subject {
  @decorate property!: Dependency;

  constructor(readonly dependency: Dependency) {}

  @decorate
  method(value: number): string {
    return String(value);
  }
}
`;

/**
 * A marker from the bundled reflect-metadata implementation.
 *
 * Any test realm that has already loaded reflection satisfies a functional
 * `Reflect.getMetadata` assertion on its own, so the bundle text is the only
 * evidence that this build carries its own reflection runtime.
 */
const REFLECTION_RUNTIME_MARKER = 'exporter("getMetadata"';

function dataModule(code: string): Promise<Record<string, unknown>> {
  return import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(code)))}`);
}

describe("SwcBundler decorator metadata", () => {
  it("leaves the default standard-decorator path with the delegate", async () => {
    const bundler = new SwcBundler();
    try {
      const result = await bundler.transform({
        code: `function logged(value: unknown) { return value; }\n@logged class Example {}`,
        loader: "ts",
        tsconfigRaw: { compilerOptions: {} },
      });

      assertStringIncludes(result.code, "Example");
    } finally {
      await bundler.stop();
    }
  });

  it("delegates non-TypeScript before reading TypeScript configuration", async () => {
    const bundler = new SwcBundler();
    try {
      const result = await bundler.transform({
        code: `export const value = 1;`,
        loader: "js",
      });

      assertStringIncludes(result.code, "value");
    } finally {
      await bundler.stop();
    }
  });

  it("keeps framework-only compiler state out of the esbuild delegate", async () => {
    const bundler = new SwcBundler();
    try {
      const result = await bundler.transform({
        code: `export const value: number = 1;`,
        loader: "ts",
        typescriptDecoratorOptions: {
          experimentalDecorators: false,
          emitDecoratorMetadata: false,
        },
      });

      assertStringIncludes(result.code, "value");
    } finally {
      await bundler.stop();
    }
  });

  it("emits legacy property, constructor, parameter, and return metadata", async () => {
    const bundler = new SwcBundler();
    const result = await bundler.transform({
      code: METADATA_SOURCE,
      loader: "ts",
      format: "esm",
      sourcefile: "fixture.ts",
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      },
    });

    for (
      const metadataKey of [
        "design:type",
        "design:paramtypes",
        "design:returntype",
      ]
    ) {
      assertStringIncludes(result.code, metadataKey);
    }

    const loaded = await dataModule(result.code) as {
      Dependency: new () => object;
      Subject: { new (dependency: object): object; prototype: object };
    };
    const metadata = Reflect as typeof Reflect & {
      getMetadata(key: string, target: object, property?: string): unknown;
    };

    assertEquals(
      metadata.getMetadata("design:type", loaded.Subject.prototype, "property"),
      loaded.Dependency,
    );
    assertEquals(metadata.getMetadata("design:paramtypes", loaded.Subject), [loaded.Dependency]);
    assertEquals(metadata.getMetadata("design:paramtypes", loaded.Subject.prototype, "method"), [
      Number,
    ]);
    assertEquals(
      metadata.getMetadata("design:returntype", loaded.Subject.prototype, "method"),
      String,
    );
    await bundler.stop();
  });

  it("honors decorator flags from string tsconfigRaw", async () => {
    const bundler = new SwcBundler();
    try {
      const result = await bundler.transform({
        code: METADATA_SOURCE,
        loader: "ts",
        format: "esm",
        sourcefile: "string-tsconfig.ts",
        tsconfigRaw: `{
          // esbuild accepts JSONC text for this option.
          "compilerOptions": {
            "experimentalDecorators": true,
            "emitDecoratorMetadata": true
          }
        }`,
      });

      assertStringIncludes(result.code, "design:paramtypes");
    } finally {
      await bundler.stop();
    }
  });

  it("rejects misleading source maps only when the SWC transform is active", async () => {
    const bundler = new SwcBundler();
    try {
      await bundler.transform({
        code: "export const value: number = 1;",
        loader: "ts",
        sourcemap: "external",
        tsconfigRaw: { compilerOptions: {} },
      });

      await assertRejects(
        () =>
          bundler.transform({
            code: METADATA_SOURCE,
            loader: "ts",
            sourcemap: "external",
            tsconfigRaw: {
              compilerOptions: {
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
              },
            },
          }),
        Error,
        "does not support source maps",
      );
    } finally {
      await bundler.stop();
    }
  });

  it("keeps JSX loaders when SWC preserves TSX", async () => {
    const bundler = new SwcBundler();
    const typescriptDecoratorOptions = {
      experimentalDecorators: true,
      emitDecoratorMetadata: false,
    };

    try {
      const transformed = await bundler.transform({
        code: "export const view = <section />;",
        loader: "tsx",
        sourcefile: "view.tsx",
        jsx: "preserve",
        tsconfigRaw: { compilerOptions: typescriptDecoratorOptions },
      });
      assertStringIncludes(transformed.code, "<section");

      const bundled = await bundler.bundle({
        bundle: true,
        write: false,
        format: "esm",
        jsx: "preserve",
        stdin: {
          contents: "export const view = <section />;",
          loader: "tsx",
          sourcefile: "view.tsx",
        },
        typescriptDecoratorOptions,
      });
      assertStringIncludes(bundled.outputFiles[0]!.text, "<section");
    } finally {
      await bundler.stop();
    }
  });

  it("keeps preserved TSX parseable through plugin and fallback loads", async () => {
    const projectDir = await makeTempDir();
    const bundler = new SwcBundler();
    const virtualView: BundlerPlugin = {
      name: "virtual-view",
      setup(build) {
        build.onResolve({ filter: /^virtual-view$/ }, () => ({
          path: "virtual-view.tsx",
          namespace: "virtual-view",
        }));
        build.onLoad(
          { filter: /.*/, namespace: "virtual-view" },
          () => ({
            contents: "export const virtualView = <section />;",
            loader: "tsx",
          }),
        );
      },
    };

    try {
      await writeTextFile(
        `${projectDir}/entry.ts`,
        `
          export { virtualView } from "virtual-view";
          export { fileView } from "./file-view.tsx";
        `,
      );
      await writeTextFile(
        `${projectDir}/file-view.tsx`,
        "export const fileView = <article />;",
      );

      const result = await bundler.bundle({
        absWorkingDir: projectDir,
        entryPoints: [`${projectDir}/entry.ts`],
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        jsx: "preserve",
        plugins: [virtualView],
        typescriptDecoratorOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: false,
        },
      });

      assertEquals(result.errors, []);
      assertStringIncludes(result.outputFiles[0]!.text, "<section");
      assertStringIncludes(result.outputFiles[0]!.text, "<article");
    } finally {
      await bundler.stop();
      await remove(projectDir, { recursive: true });
    }
  });

  it("honors decorator flags inherited through tsconfig", async () => {
    const projectDir = await makeTempDir();
    const bundler = new SwcBundler();
    try {
      await writeTextFile(
        `${projectDir}/base.json`,
        JSON.stringify({
          compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
          },
        }),
      );
      await writeTextFile(
        `${projectDir}/tsconfig.json`,
        `{
          // The extension must follow the project compiler configuration.
          "extends": "./base.json"
        }`,
      );

      const result = await bundler.transform({
        absWorkingDir: projectDir,
        sourcefile: `${projectDir}/fixture.ts`,
        code: METADATA_SOURCE,
        loader: "ts",
        format: "esm",
      });

      assertStringIncludes(result.code, "design:paramtypes");
    } finally {
      await bundler.stop();
      await remove(projectDir, { recursive: true });
    }
  });

  it("resolves an explicit relative tsconfig from absWorkingDir", async () => {
    const projectDir = await makeTempDir();
    const bundler = new SwcBundler();
    try {
      await writeTextFile(
        `${projectDir}/legacy.json`,
        JSON.stringify({
          compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
          },
        }),
      );

      const result = await bundler.transform({
        absWorkingDir: projectDir,
        tsconfig: "legacy.json",
        sourcefile: `${projectDir}/fixture.ts`,
        code: METADATA_SOURCE,
        loader: "ts",
        format: "esm",
      });

      assertStringIncludes(result.code, "design:paramtypes");
    } finally {
      await bundler.stop();
      await remove(projectDir, { recursive: true });
    }
  });

  it("preserves CommonJS output for .cts transforms", async () => {
    const projectDir = await makeTempDir();
    const bundler = new SwcBundler();
    try {
      const result = await bundler.transform({
        code: `
          function decorateClass(): ClassDecorator { return () => {}; }
          @decorateClass()
          class Service {}
          export = Service;
        `,
        loader: "ts",
        sourcefile: "service.cts",
        tsconfigRaw: {
          compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: false,
          },
        },
      });

      assertStringIncludes(result.code, "module.exports");

      await writeTextFile(
        `${projectDir}/service.cts`,
        `
          function decorateClass(): ClassDecorator { return () => {}; }
          @decorateClass()
          class BundledService { static kind = "cts"; }
          export = BundledService;
        `,
      );
      await writeTextFile(
        `${projectDir}/entry.js`,
        `
          import BundledService from "./service.cts";
          export const serviceKind = BundledService.kind;
        `,
      );
      const bundled = await bundler.bundle({
        absWorkingDir: projectDir,
        entryPoints: [`${projectDir}/entry.js`],
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        typescriptDecoratorOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: false,
        },
      });
      const loaded = await dataModule(bundled.outputFiles[0]!.text);
      assertEquals(loaded.serviceKind, "cts");
    } finally {
      await bundler.stop();
      await remove(projectDir, { recursive: true });
    }
  });

  it("transforms TypeScript returned by virtual project loaders", async () => {
    const bundler = new SwcBundler();
    const virtualDependency: BundlerPlugin = {
      name: "virtual-dependency",
      setup(build) {
        build.onResolve({ filter: /^\.\/dependency\.ts$/ }, () => ({
          path: "dependency.ts",
          namespace: "virtual-project",
        }));
        build.onLoad(
          { filter: /.*/, namespace: "virtual-project" },
          () => ({
            contents: `export class Dependency {}`,
            loader: "ts",
          }),
        );
      },
    };

    try {
      const result = await bundler.bundle({
        bundle: true,
        write: false,
        format: "esm",
        plugins: [virtualDependency],
        stdin: {
          sourcefile: "virtual-entry.ts",
          resolveDir: cwd(),
          loader: "ts",
          contents: `
            import { Dependency } from "./dependency.ts";
            function decorate(..._args: unknown[]): void {}
            export class Subject { @decorate value!: Dependency; }
            export function propertyType() {
              return Reflect.getMetadata("design:type", Subject.prototype, "value")?.name;
            }
          `,
        },
        tsconfigRaw: {
          compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
          },
        },
      });
      const loaded = await dataModule(result.outputFiles[0]!.text) as {
        propertyType(): string;
      };

      assertEquals(loaded.propertyType(), "Dependency");
    } finally {
      await bundler.stop();
    }
  });

  it("initializes reflection for entry-point bundles", async () => {
    const projectDir = await makeTempDir();
    const bundler = new SwcBundler();
    try {
      await writeTextFile(`${projectDir}/entry.ts`, METADATA_SOURCE);

      const result = await bundler.bundle({
        entryPoints: [`${projectDir}/entry.ts`],
        bundle: true,
        write: false,
        format: "esm",
        typescriptDecoratorOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      });

      assertEquals(result.errors, []);
      assertStringIncludes(result.outputFiles[0]!.text, "design:paramtypes");
      assertStringIncludes(result.outputFiles[0]!.text, REFLECTION_RUNTIME_MARKER);
    } finally {
      await bundler.stop();
      await remove(projectDir, { recursive: true });
    }
  });

  it("inlines reflection for nonbundled TypeScript output", async () => {
    const bundler = new SwcBundler();
    try {
      const result = await bundler.bundle({
        bundle: false,
        write: false,
        format: "esm",
        stdin: {
          sourcefile: "middleware.ts",
          resolveDir: cwd(),
          loader: "ts",
          contents: METADATA_SOURCE,
        },
        typescriptDecoratorOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      });

      assertEquals(result.errors, []);
      assertStringIncludes(result.outputFiles[0]!.text, "design:paramtypes");
      assertStringIncludes(result.outputFiles[0]!.text, REFLECTION_RUNTIME_MARKER);
      assertEquals(result.outputFiles[0]!.text.includes("veryfront:swc-reflect-metadata"), false);
    } finally {
      await bundler.stop();
    }
  });

  it("keeps a plugin's explicit non-TypeScript loader", async () => {
    const bundler = new SwcBundler();
    const rawText: BundlerPlugin = {
      name: "raw-text",
      setup(build) {
        build.onResolve({ filter: /^\.\/notes\.ts$/ }, () => ({
          path: "notes.ts",
          namespace: "raw-text",
        }));
        build.onLoad(
          { filter: /.*/, namespace: "raw-text" },
          () => ({ contents: "class NotTypeScript {", loader: "text" }),
        );
      },
    };

    try {
      const result = await bundler.bundle({
        bundle: true,
        write: false,
        format: "esm",
        plugins: [rawText],
        stdin: {
          sourcefile: "raw-entry.ts",
          resolveDir: cwd(),
          loader: "ts",
          contents: `
            import notes from "./notes.ts";
            export function raw(): string { return notes; }
          `,
        },
        typescriptDecoratorOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      });

      assertEquals(result.errors, []);
      const loaded = await dataModule(result.outputFiles[0]!.text) as {
        raw(): string;
      };
      assertEquals(loaded.raw(), "class NotTypeScript {");
    } finally {
      await bundler.stop();
    }
  });

  it("bundles and evaluates a class-validator fixture with reflection initialized", async () => {
    const bundler = new SwcBundler();
    try {
      const result = await bundler.bundle({
        absWorkingDir: cwd(),
        bundle: true,
        write: false,
        format: "esm",
        platform: "node",
        target: "es2022",
        stdin: {
          sourcefile: "class-validator-fixture.ts",
          resolveDir: cwd(),
          loader: "ts",
          contents: `
            import { IsString, validateSync } from "class-validator";

            export class UserDto {
              @IsString()
              name!: string;
            }

            export function validateName(name: unknown) {
              const input = new UserDto();
              input.name = name as string;
              return validateSync(input).map((error) => error.property);
            }

            export function propertyType() {
              return Reflect.getMetadata("design:type", UserDto.prototype, "name")?.name;
            }
          `,
        },
        tsconfigRaw: {
          compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
          },
        },
      });
      assertEquals(result.errors, []);
      assertStringIncludes(result.outputFiles[0]!.text, REFLECTION_RUNTIME_MARKER);
      const loaded = await dataModule(result.outputFiles[0]!.text) as {
        propertyType(): string;
        validateName(value: unknown): ValidationError[] | string[];
      };

      assertEquals(loaded.propertyType(), "String");
      assertEquals(loaded.validateName("Ada"), []);
      assertEquals(loaded.validateName(42), ["name"]);
    } finally {
      await bundler.stop();
    }
  });
});
