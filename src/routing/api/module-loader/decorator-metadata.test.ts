import "#veryfront/schemas/_test-setup.ts";
import { SwcBundler } from "@veryfront/ext-bundler-swc";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { denoAdapter } from "#veryfront/platform/adapters/deno.ts";
import type { Bundler } from "#veryfront/extensions/bundler/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { loadHandlerModule, prepareHandlerModule } from "./loader.ts";
import type { AppRouteContext, AppRouteHandler } from "./types.ts";

describe("API route decorator metadata", () => {
  it("uses the selected SWC transform for local Deno source execution", async () => {
    const projectDir = await Deno.makeTempDir();
    const modulePath = join(projectDir, "handler.ts");
    const previousBundler = tryResolve<Bundler>("Bundler");
    const swcBundler = new SwcBundler();

    try {
      await Deno.writeTextFile(
        join(projectDir, "tsconfig.base.json"),
        JSON.stringify({
          compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
          },
        }),
      );
      await Deno.writeTextFile(
        join(projectDir, "tsconfig.json"),
        JSON.stringify({ extends: "./tsconfig.base.json" }),
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
            const constructor = Reflect.getMetadata(
              "design:paramtypes",
              Subject,
            )?.map((type: Function) => type.name);
            return Response.json({ property, constructor });
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
        constructor: ["Dependency"],
      });

      const preparedModule = await prepareHandlerModule({
        projectDir,
        modulePath,
        adapter: denoAdapter,
      });
      assertEquals(preparedModule.source.includes("design:paramtypes"), true);
      assertEquals(preparedModule.source.includes("getMetadata"), true);
    } finally {
      unregister("Bundler");
      if (previousBundler) register("Bundler", previousBundler);
      await swcBundler.stop();
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
