import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CSSPurgingEngine, CSSPurgingRequest } from "#veryfront/extensions/css/index.ts";
import { createCSSPurgingSession } from "./purging-engine.ts";

function engine(
  run: (request: CSSPurgingRequest) => unknown,
  cacheIdentity = "test-css-purging@1",
): CSSPurgingEngine {
  return {
    cacheIdentity,
    purge: (request) => Promise.resolve(run(request)) as never,
  };
}

const request = {
  css: ".used {} .unused {}",
  content: [{ raw: '<div class="used"></div>', extension: "html" }],
  safelist: [],
  includeRejectedCSS: true,
} as const;

describe("CSS purging engine boundary", () => {
  it("captures identity and freezes a detached request snapshot", async () => {
    let received: CSSPurgingRequest | undefined;
    const implementation = engine((value) => {
      received = value;
      return { css: ".used {}", rejectedCSS: ".unused {}" };
    });
    const session = createCSSPurgingSession(implementation);
    (implementation as { cacheIdentity: string }).cacheIdentity = "mutated@2";

    const result = await session.run(request);
    assertEquals(session.cacheIdentity, "test-css-purging@1");
    assertEquals(result, { css: ".used {}", rejectedCSS: ".unused {}" });
    assertEquals(Object.isFrozen(received), true);
    assertEquals(Object.isFrozen(received?.content), true);
    assertEquals(Object.isFrozen(received?.content[0]), true);
  });

  it("does not invoke request or result accessors", async () => {
    let requestGetterCalls = 0;
    const session = createCSSPurgingSession(engine(() => ({
      get css() {
        requestGetterCalls++;
        return ".used {}";
      },
      rejectedCSS: ".unused {}",
    })));

    await assertRejects(() => session.run(request), TypeError, "data property");
    assertEquals(requestGetterCalls, 0);

    let inputGetterCalls = 0;
    await assertRejects(
      () =>
        session.run({
          get css() {
            inputGetterCalls++;
            return ".used {}";
          },
          content: request.content,
          safelist: [],
          includeRejectedCSS: true,
        }),
      TypeError,
      "data property",
    );
    assertEquals(inputGetterCalls, 0);
  });

  it("rejects missing, unrequested, and oversized rejected output", async () => {
    await assertRejects(
      () => createCSSPurgingSession(engine(() => ({ css: ".used {}" }))).run(request),
      TypeError,
      "did not return requested",
    );
    await assertRejects(
      () =>
        createCSSPurgingSession(
          engine(() => ({ css: ".used {}", rejectedCSS: ".unused {}" })),
        ).run({ ...request, includeRejectedCSS: false }),
      TypeError,
      "unrequested",
    );
    await assertRejects(
      () =>
        createCSSPurgingSession(
          engine(() => ({ css: ".used {}", rejectedCSS: "x".repeat(32 * 1024 * 1024 + 1) })),
        ).run(request),
      TypeError,
      "resource limits",
    );
  });

  it("rejects inherited identities and accessor methods", () => {
    assertThrows(
      () =>
        createCSSPurgingSession(Object.create({
          cacheIdentity: "inherited@1",
          purge: () => Promise.resolve({ css: "" }),
        })),
      TypeError,
      "own data property",
    );
    assertThrows(
      () =>
        createCSSPurgingSession({
          cacheIdentity: "accessor@1",
          get purge() {
            throw new Error("must not invoke");
          },
        } as never),
      TypeError,
      "data property",
    );
  });
});
