import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { type CSSPurgingEngine, CSSPurgingEngineName } from "veryfront/extensions/css";
import { createCSSPurgingSession } from "../../../src/build/asset-pipeline/css-optimizer/purging-engine.ts";
import extensionPackage from "../deno.json" with { type: "json" };
import factory from "./index.ts";

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };

async function createEngine(): Promise<CSSPurgingEngine> {
  let engine: CSSPurgingEngine | undefined;
  await factory().setup?.({
    config: {},
    logger: noopLogger,
    provide: (name, implementation) => {
      if (name === CSSPurgingEngineName) {
        engine = implementation as CSSPurgingEngine;
      }
    },
    get: () => undefined,
    require: () => {
      throw new Error("not used");
    },
  });
  if (engine === undefined) {
    throw new Error("ext-css-purgecss did not provide CSSPurgingEngine");
  }
  return engine;
}

describe("ext-css-purgecss", () => {
  it("aligns explicit factory metadata and immutable identity with the package", async () => {
    const provided = new Map<string, unknown>();
    const extension = factory();
    assertEquals(extensionPackage.veryfront.activation, "explicit");
    assertEquals(extension.version, extensionPackage.version);
    assertEquals(extension.contracts?.provides, [CSSPurgingEngineName]);
    assertEquals(extensionPackage.veryfront.capabilities, [
      { type: "system:read", apis: ["cpus"] },
    ]);
    assertEquals(
      extension.capabilities,
      extensionPackage.veryfront.capabilities,
    );
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
    const engine = provided.get(
      CSSPurgingEngineName,
    ) as CSSPurgingEngine;
    assertEquals(Object.isFrozen(engine), true);
    assertStringIncludes(
      engine.cacheIdentity,
      `ext-css-purgecss@${extensionPackage.version}`,
    );
    assertStringIncludes(engine.cacheIdentity, "purgecss@8.0.0");
    assertThrows(
      () => {
        (engine as { cacheIdentity: string }).cacheIdentity = "changed@2";
      },
      TypeError,
    );
  });

  it("purges nested rules and returns rejected CSS through the core boundary", async () => {
    const session = createCSSPurgingSession(await createEngine());
    const result = await session.run({
      css: ".used { color: red } .unused { color: blue } " +
        "@media (min-width: 40rem) { .used { display: flex } .aside { display: block } }",
      content: [{ raw: '<div class="used"></div>', extension: "html" }],
      safelist: [],
      includeRejectedCSS: true,
    });
    assertEquals(result.css.includes(".used"), true);
    assertEquals(result.css.includes(".unused"), false);
    assertEquals(result.css.includes("@media"), true);
    assertEquals(result.css.includes(".aside"), false);
    assertEquals(result.rejectedCSS?.includes(".unused"), true);
    assertEquals(result.rejectedCSS?.includes(".aside"), true);
    assertEquals(Object.isFrozen(result), true);
  });

  it("honors a bounded safelist without returning unrequested rejected CSS", async () => {
    const session = createCSSPurgingSession(await createEngine());
    const result = await session.run({
      css: ".used { color: red } .dynamic { color: blue } .unused { color: black }",
      content: [{ raw: '<div class="used"></div>', extension: "html" }],
      safelist: ["dynamic"],
      includeRejectedCSS: false,
    });
    assertEquals(result.css.includes(".used"), true);
    assertEquals(result.css.includes(".dynamic"), true);
    assertEquals(result.css.includes(".unused"), false);
    assertEquals("rejectedCSS" in result, false);
  });

  it("preserves normalized tag and class evidence through the provider", async () => {
    const session = createCSSPurgingSession(await createEngine());
    const result = await session.run({
      css: "body { margin: 0 } .keep { display: block } .remove { display: none }",
      content: [{ raw: "body keep", extension: "html" }],
      safelist: ["body", "keep"],
      includeRejectedCSS: false,
    });
    assertEquals(result.css.includes("body"), true);
    assertEquals(result.css.includes(".keep"), true);
    assertEquals(result.css.includes(".remove"), false);
  });

  it("rejects inherited, populated, accessor, and revoked configuration", () => {
    assertThrows(
      () => factory(Object.create({ option: true })),
      TypeError,
      "must not inherit",
    );
    assertThrows(
      () => factory({ option: true }),
      TypeError,
      "does not accept",
    );

    let getterCalls = 0;
    assertThrows(
      () =>
        factory({
          get option() {
            getterCalls++;
            return true;
          },
        }),
      TypeError,
      "does not accept",
    );
    assertEquals(getterCalls, 0);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    assertThrows(
      () => factory(revoked.proxy),
      TypeError,
      "could not be inspected",
    );
  });

  it("never lets hostile request accessors cross the validated boundary", async () => {
    const session = createCSSPurgingSession(await createEngine());
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
