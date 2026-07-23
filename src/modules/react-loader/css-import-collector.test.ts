import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getCSSImports, registerCSSImport, runWithCSSCollector } from "./css-import-collector.ts";

describe("modules/react-loader/css-import-collector", () => {
  it("deduplicates imports and returns a defensive snapshot", async () => {
    const collected = await runWithCSSCollector(() => {
      registerCSSImport("/project/styles.css");
      registerCSSImport("/project/styles.css");
      const snapshot = getCSSImports();
      snapshot.push("/injected.css");
      return getCSSImports();
    });

    assertEquals(collected.result, ["/project/styles.css"]);
    assertEquals(collected.cssImports, ["/project/styles.css"]);
  });

  it("isolates concurrent collector contexts", async () => {
    const [first, second] = await Promise.all([
      runWithCSSCollector(async () => {
        registerCSSImport("/first.css");
        await Promise.resolve();
      }),
      runWithCSSCollector(async () => {
        registerCSSImport("/second.css");
        await Promise.resolve();
      }),
    ]);

    assertEquals(first.cssImports, ["/first.css"]);
    assertEquals(second.cssImports, ["/second.css"]);
  });

  it("rejects invalid paths inside an active collector", async () => {
    await assertRejects(
      () => runWithCSSCollector(() => registerCSSImport("relative.css")),
      TypeError,
      "absolute",
    );
  });

  it("bounds unique imports in one request", async () => {
    await assertRejects(
      () =>
        runWithCSSCollector(() => {
          for (let index = 0; index <= 10_000; index++) {
            registerCSSImport(`/project/style-${index}.css`);
          }
        }),
      RangeError,
      "request limit",
    );
  });
});
