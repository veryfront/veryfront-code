import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { CSSPurgingEngineName } from "veryfront/extensions/css";
import { createCSSPurgingSession } from "../../../src/build/asset-pipeline/css-optimizer/purging-engine.ts";
import factory, { PurgeCSSPurgingEngine } from "./index.ts";
import extensionPackage from "../deno.json" with { type: "json" };

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };

describe("ext-css-purgecss", () => {
  it("aligns factory metadata and cache identity with the package", async () => {
    const provided = new Map<string, unknown>();
    const extension = factory();
    assertEquals(extensionPackage.veryfront.activation, "explicit");
    assertEquals(extension.version, extensionPackage.version);
    assertEquals(extension.contracts?.provides, [CSSPurgingEngineName]);
    assertEquals(extensionPackage.veryfront.capabilities, [
      { type: "system:read", apis: ["cpus"] },
    ]);
    assertEquals(extension.capabilities, extensionPackage.veryfront.capabilities);
    assertEquals(
      extensionPackage.tasks.test,
      "deno test --frozen --no-check --allow-sys=cpus src/",
    );
    await extension.setup?.({
      config: {},
      logger: noopLogger,
      provide: (name, implementation) => provided.set(name, implementation),
      get: () => undefined,
      require: () => {
        throw new Error("not used");
      },
    });
    const engine = provided.get(CSSPurgingEngineName) as PurgeCSSPurgingEngine;
    assertStringIncludes(engine.cacheIdentity, `ext-css-purgecss@${extensionPackage.version}`);
    assertStringIncludes(engine.cacheIdentity, "purgecss@8.0.0");
    assertEquals(Object.isFrozen(engine), true);
  });

  it("purges and returns rejected CSS through the validated core boundary", async () => {
    const session = createCSSPurgingSession(new PurgeCSSPurgingEngine());
    const result = await session.run({
      css: ".used { color: red } .unused { color: blue }",
      content: [{ raw: '<div class="used"></div>', extension: "html" }],
      safelist: [],
      includeRejectedCSS: true,
    });
    assertEquals(result.css.includes(".used"), true);
    assertEquals(result.css.includes(".unused"), false);
    assertEquals(result.rejectedCSS?.includes(".unused"), true);
  });

  it("rejects inherited config and hostile requests", async () => {
    assertThrows(
      () => factory(Object.create({ option: true })),
      TypeError,
      "must not inherit",
    );
    const session = createCSSPurgingSession(new PurgeCSSPurgingEngine());
    let getterCalls = 0;
    await assertRejects(
      () =>
        session.run({
          get css() {
            getterCalls++;
            return ".x {}";
          },
          content: [{ raw: '<div class="x"></div>', extension: "html" }],
          safelist: [],
          includeRejectedCSS: false,
        }),
      TypeError,
      "data property",
    );
    assertEquals(getterCalls, 0);
  });
});
