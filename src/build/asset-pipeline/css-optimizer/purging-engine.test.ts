import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  CSSPurgingEngine,
  CSSPurgingRequest,
  CSSPurgingResult,
} from "#veryfront/extensions/css/index.ts";
import { CSSPurgingEngineName } from "#veryfront/extensions/css/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { MAX_CSS_OUTPUT_FILE_BYTES } from "./constants.ts";
import {
  acquireConfiguredCSSPurging,
  assertCSSPurgingSession,
  createCSSPurgingSession,
} from "./purging-engine.ts";

function engine(
  run: (request: CSSPurgingRequest) => unknown | Promise<unknown>,
  cacheIdentity = "test-css-purging@1",
): CSSPurgingEngine {
  return {
    cacheIdentity,
    purge: async (request): Promise<CSSPurgingResult> => await run(request) as CSSPurgingResult,
  };
}

function request(includeRejectedCSS = true): CSSPurgingRequest {
  return {
    css: ".used {} .unused {}",
    content: [{ raw: '<div class="used"></div>', extension: "html" }],
    safelist: [],
    includeRejectedCSS,
  };
}

describe("CSS purging engine boundary", () => {
  it("captures one immutable provider and detached request per operation", async () => {
    let received: CSSPurgingRequest | undefined;
    const implementation = engine((value) => {
      received = value;
      return { css: ".used {}", rejectedCSS: ".unused {}" };
    });
    const session = createCSSPurgingSession(implementation);
    assertCSSPurgingSession(session);
    (implementation as { cacheIdentity: string }).cacheIdentity = "mutated@2";
    implementation.purge = () =>
      Promise.resolve({ css: "replacement", rejectedCSS: "replacement" });

    const input = request();
    const result = await session.run(input);
    assertEquals(session.cacheIdentity, "test-css-purging@1");
    assertEquals(result, { css: ".used {}", rejectedCSS: ".unused {}" });
    assertEquals(Object.isFrozen(session), true);
    assertEquals(Object.isFrozen(result), true);
    assertEquals(Object.isFrozen(received), true);
    assertEquals(Object.isFrozen(received?.content), true);
    assertEquals(Object.isFrozen(received?.content[0]), true);
    assertEquals(Object.isFrozen(received?.safelist), true);
    assertThrows(
      () =>
        assertCSSPurgingSession({
          cacheIdentity: session.cacheIdentity,
          run: session.run,
        }),
      TypeError,
      "must be created by core",
    );
  });

  it("does not invoke request, content, array-iterator, or result accessors", async () => {
    let requestGetterCalls = 0;
    const session = createCSSPurgingSession(
      engine(() => ({ css: ".used {}", rejectedCSS: ".unused {}" })),
    );
    await assertRejects(
      () =>
        session.run({
          get css() {
            requestGetterCalls++;
            return ".used {}";
          },
          content: request().content,
          safelist: [],
          includeRejectedCSS: true,
        }),
      TypeError,
      "data property",
    );
    assertEquals(requestGetterCalls, 0);

    let contentGetterCalls = 0;
    await assertRejects(
      () =>
        session.run({
          ...request(),
          content: [{
            get raw() {
              contentGetterCalls++;
              return "<div></div>";
            },
            extension: "html",
          }],
        }),
      TypeError,
      "data property",
    );
    assertEquals(contentGetterCalls, 0);

    let iteratorGetterCalls = 0;
    const content = [...request().content];
    Object.defineProperty(content, Symbol.iterator, {
      get() {
        iteratorGetterCalls++;
        return Array.prototype[Symbol.iterator];
      },
    });
    await assertRejects(
      () => session.run({ ...request(), content }),
      TypeError,
      "dense data-property array",
    );
    assertEquals(iteratorGetterCalls, 0);

    let resultGetterCalls = 0;
    const hostileResult = createCSSPurgingSession(engine(() => ({
      get css() {
        resultGetterCalls++;
        return ".used {}";
      },
      rejectedCSS: ".unused {}",
    })));
    await assertRejects(
      () => hostileResult.run(request()),
      TypeError,
      "data property",
    );
    assertEquals(resultGetterCalls, 0);
  });

  it("rejects sparse arrays, unknown properties, hostile proxies, and unsafe tokens", async () => {
    const session = createCSSPurgingSession(
      engine(() => ({ css: ".used {}", rejectedCSS: ".unused {}" })),
    );
    const sparse = new Array(1) as CSSPurgingRequest["content"];
    await assertRejects(
      () => session.run({ ...request(), content: sparse }),
      TypeError,
      "must define 0",
    );
    await assertRejects(
      () =>
        session.run({
          ...request(),
          content: [{
            raw: "<div></div>",
            extension: "HTML",
          }],
        }),
      TypeError,
      "malformed",
    );
    await assertRejects(
      () =>
        session.run({
          ...request(),
          safelist: ["not normalized\u0301"],
        }),
      TypeError,
      "unsafe token",
    );
    await assertRejects(
      () =>
        session.run({
          ...request(),
          unexpected: true,
        } as CSSPurgingRequest),
      TypeError,
      "unsupported properties",
    );

    const revoked = Proxy.revocable(request(), {});
    revoked.revoke();
    await assertRejects(
      () => session.run(revoked.proxy),
      TypeError,
      "could not be inspected",
    );
  });

  it("rejects malformed, unrequested, and oversized provider output", async () => {
    await assertRejects(
      () => createCSSPurgingSession(engine(() => ({ css: ".used {}" }))).run(request()),
      TypeError,
      "must define rejectedCSS",
    );
    await assertRejects(
      () =>
        createCSSPurgingSession(
          engine(() => ({ css: ".used {}", rejectedCSS: undefined })),
        ).run(request(false)),
      TypeError,
      "unrequested",
    );
    await assertRejects(
      () =>
        createCSSPurgingSession(
          engine(() => ({
            css: "x".repeat(MAX_CSS_OUTPUT_FILE_BYTES + 1),
          })),
        ).run(request(false)),
      TypeError,
      "resource limits",
    );

    const hostile = new Proxy({
      css: ".used {}",
      rejectedCSS: ".unused {}",
    }, {
      ownKeys() {
        throw new Error("descriptor trap");
      },
    });
    await assertRejects(
      () => createCSSPurgingSession(engine(() => hostile)).run(request()),
      TypeError,
      "could not be inspected",
    );
  });

  it("rejects inherited identities and accessor methods without invoking them", () => {
    assertThrows(
      () =>
        createCSSPurgingSession(Object.create({
          cacheIdentity: "inherited@1",
          purge: () => Promise.resolve({ css: "" }),
        })),
      TypeError,
      "own data property",
    );
    let getterCalls = 0;
    assertThrows(
      () =>
        createCSSPurgingSession({
          cacheIdentity: "accessor@1",
          get purge() {
            getterCalls++;
            throw new Error("must not invoke");
          },
        } as never),
      TypeError,
      "data property",
    );
    assertEquals(getterCalls, 0);
  });

  it("fails closed when no provider is configured", () => {
    const previous = tryResolve<CSSPurgingEngine>(CSSPurgingEngineName);
    unregister(CSSPurgingEngineName);
    try {
      assertThrows(
        () => acquireConfiguredCSSPurging(),
        Error,
        'Missing extension for contract "CSSPurgingEngine"',
      );
    } finally {
      if (previous !== undefined) {
        register(CSSPurgingEngineName, previous);
      }
    }
  });
});
