import "#veryfront/schemas/_test-setup.ts";
import { SwcBundler } from "@veryfront/ext-bundler-swc";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { denoAdapter } from "#veryfront/platform/adapters/deno.ts";
import type { Bundler } from "#veryfront/extensions/bundler/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  loadHandlerModule,
  prepareHandlerModule,
} from "#veryfront/routing/api/module-loader/loader.ts";
import type {
  AppRouteContext,
  AppRouteHandler,
} from "#veryfront/routing/api/module-loader/types.ts";

describe("API route decorator metadata", () => {
  it("allows trusted host config inheritance but rejects it during isolated preparation", async () => {
    const workspaceDir = await Deno.makeTempDir();
    const projectDir = join(workspaceDir, "app");
    await Deno.mkdir(projectDir);
    const modulePath = join(projectDir, "handler.ts");
    const previousBundler = tryResolve<Bundler>("Bundler");
    const swcBundler = new SwcBundler();

    try {
      await Deno.writeTextFile(
        join(workspaceDir, "tsconfig.base.json"),
        JSON.stringify({
          compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
          },
        }),
      );
      await Deno.writeTextFile(
        join(projectDir, "tsconfig.json"),
        JSON.stringify({ extends: "../tsconfig.base.json" }),
      );
      await Deno.writeTextFile(
        modulePath,
        `
          function decorate(..._args: unknown[]): void {}
          function decorateClass(): ClassDecorator { return () => {}; }
          class Dependency {}

          @decorateClass()
          class Subject {
            @decorate property!: string;
            constructor(readonly dependency: Dependency) {}
          }

          export function GET() {
            const property = Reflect.getMetadata(
              "design:type",
              Subject.prototype,
              "property",
            )?.name;
            const constructorParams = Reflect.getMetadata(
              "design:paramtypes",
              Subject,
            )?.map((type: { name: string }) => type.name);
            return Response.json({ property, constructorParams });
          }
        `,
      );

      register("Bundler", swcBundler);
      const route = await loadHandlerModule({
        projectDir,
        modulePath,
        adapter: denoAdapter,
        allowHostProjectCodeExecution: true,
      });
      const handler = route?.GET as AppRouteHandler;
      const response = await handler(
        new Request("http://localhost/api/metadata"),
        { params: {}, env: {} } satisfies AppRouteContext,
      );

      assertEquals(await response.json(), {
        property: "String",
        constructorParams: ["Dependency"],
      });

      for (
        const inheritedConfig of [
          "../tsconfig.base.json",
          join(workspaceDir, "tsconfig.base.json"),
        ]
      ) {
        await Deno.writeTextFile(
          join(projectDir, "tsconfig.json"),
          JSON.stringify({ extends: inheritedConfig }),
        );
        const error = await assertRejects(
          () =>
            prepareHandlerModule({
              projectDir,
              modulePath,
              adapter: denoAdapter,
            }),
          Error,
          "requires trusted host execution",
        );
        assertInstanceOf(error, Error);
        assertEquals(error.message.includes(workspaceDir), false);
      }

      await Deno.writeTextFile(
        join(projectDir, "tsconfig.json"),
        `/*${"x".repeat(1024 * 1024)}*/{}`,
      );
      await assertRejects(
        () =>
          prepareHandlerModule({
            projectDir,
            modulePath,
            adapter: denoAdapter,
          }),
        Error,
        "exceeds 1048576 bytes",
      );
    } finally {
      unregister("Bundler");
      if (previousBundler) register("Bundler", previousBundler);
      await swcBundler.stop();
      await Deno.remove(workspaceDir, { recursive: true });
    }
  });

  it("uses package config inheritance inside an isolated project boundary", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = join(projectDir, "handler.ts");
    const packageDir = join(projectDir, "node_modules", "@fixture", "tsconfig");
    const previousBundler = tryResolve<Bundler>("Bundler");
    const swcBundler = new SwcBundler();

    try {
      await Deno.mkdir(packageDir, { recursive: true });
      await Deno.writeTextFile(
        join(packageDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
          },
        }),
      );
      await Deno.writeTextFile(
        join(projectDir, "tsconfig.json"),
        JSON.stringify({ extends: "@fixture/tsconfig" }),
      );
      await Deno.writeTextFile(
        modulePath,
        `
          function decorate(..._args: unknown[]): void {}
          class Dependency {}
          class Subject {
            constructor(@decorate readonly dependency: Dependency) {}
          }
          export function GET() { return Response.json(Subject); }
        `,
      );

      register("Bundler", swcBundler);
      const preparedModule = await prepareHandlerModule({
        projectDir,
        modulePath,
        adapter: denoAdapter,
      });
      assertStringIncludes(preparedModule.source, "design:paramtypes");
      assertStringIncludes(preparedModule.source, "getMetadata");
    } finally {
      unregister("Bundler");
      if (previousBundler) register("Bundler", previousBundler);
      await swcBundler.stop();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("transforms opted-in TypeScript imported by a JavaScript route", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = join(projectDir, "handler.js");
    const previousBundler = tryResolve<Bundler>("Bundler");
    const swcBundler = new SwcBundler();

    try {
      await Deno.writeTextFile(
        join(projectDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
          },
        }),
      );
      await Deno.writeTextFile(
        join(projectDir, "dependency.ts"),
        `
          function decorate(..._args: unknown[]): void {}
          export class Subject { @decorate value!: string; }
          export function propertyType() {
            return Reflect.getMetadata("design:type", Subject.prototype, "value")?.name;
          }
        `,
      );
      await Deno.writeTextFile(
        modulePath,
        `
          import { propertyType } from "./dependency.ts";
          export function GET() { return Response.json(propertyType()); }
        `,
      );

      register("Bundler", swcBundler);
      const route = await loadHandlerModule({
        projectDir,
        modulePath,
        adapter: denoAdapter,
        allowHostProjectCodeExecution: true,
      });
      const handler = route?.GET as AppRouteHandler;
      const response = await handler(
        new Request("http://localhost/api/javascript-entry"),
        { params: {}, env: {} } satisfies AppRouteContext,
      );
      assertEquals(await response.json(), "String");
    } finally {
      unregister("Bundler");
      if (previousBundler) register("Bundler", previousBundler);
      await swcBundler.stop();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps flags-off local routes in one shared Deno module graph", async () => {
    const projectDir = await Deno.makeTempDir();
    const previousBundler = tryResolve<Bundler>("Bundler");
    const swcBundler = new SwcBundler();

    try {
      await Deno.writeTextFile(
        join(projectDir, "shared.ts"),
        `
          let count = 0;
          export function next(): number { return ++count; }
        `,
      );
      for (const route of ["first", "second"]) {
        await Deno.writeTextFile(
          join(projectDir, `${route}.ts`),
          `
            import { next } from "./shared.ts";
            export function GET() { return Response.json(next()); }
          `,
        );
      }

      register("Bundler", swcBundler);
      const values: number[] = [];
      for (const route of ["first", "second"]) {
        const loaded = await loadHandlerModule({
          projectDir,
          modulePath: join(projectDir, `${route}.ts`),
          adapter: denoAdapter,
          allowHostProjectCodeExecution: true,
        });
        const handler = loaded?.GET as AppRouteHandler;
        const response = await handler(
          new Request(`http://localhost/api/${route}`),
          { params: {}, env: {} } satisfies AppRouteContext,
        );
        values.push(await response.json());
      }

      assertEquals(values, [1, 2]);
    } finally {
      unregister("Bundler");
      if (previousBundler) register("Bundler", previousBundler);
      await swcBundler.stop();
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
