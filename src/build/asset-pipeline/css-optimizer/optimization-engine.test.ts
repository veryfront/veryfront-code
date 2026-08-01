import "#veryfront/schemas/_test-setup.ts";
import type { CSSOptimizationEngine } from "#veryfront/extensions/css/index.ts";
import { CSSOptimizationEngineName } from "#veryfront/extensions/css/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createTestCSSOptimizationEngine,
  createTestCSSSourceMap,
  withTestCSSOptimizationEngine,
} from "../../../../tests/_helpers/css-optimization-engine.ts";
import { MAX_CSS_OUTPUT_FILE_BYTES } from "./constants.ts";
import {
  createCSSOptimizationSession,
  runConfiguredCSSOptimization,
  runCSSOptimizationEngine,
} from "./optimization-engine.ts";
import { basicMinify } from "./utils.ts";

const request = {
  css: ".field { color: red; }",
  sourcePath: "field.css",
  minify: true,
  sourceMap: false,
} as const;

describe("CSS optimization engine boundary", () => {
  it("keeps basicMinify synchronous and delegates without a fallback", async () => {
    await withTestCSSOptimizationEngine(
      createTestCSSOptimizationEngine((received) => {
        assertEquals(received, {
          css: request.css,
          sourcePath: "inline.css",
          minify: true,
          sourceMap: false,
        });
        return { css: ".field{color:red}" };
      }),
      () => {
        const result = basicMinify(request.css);
        assertEquals(result, ".field{color:red}");
        assertEquals(typeof result, "string");
      },
    );
  });

  it("fails closed with the recommended extension when no engine is composed", () => {
    const previous = tryResolve<CSSOptimizationEngine>(CSSOptimizationEngineName);
    unregister(CSSOptimizationEngineName);
    try {
      assertThrows(
        () => runConfiguredCSSOptimization(request),
        Error,
        "deno add npm:@veryfront/ext-css-lightning",
      );
    } finally {
      if (previous !== undefined) {
        register(CSSOptimizationEngineName, previous);
      }
    }
  });

  it("snapshots primitive request data before crossing the boundary", () => {
    const mutableRequest = { ...request } as {
      css: string;
      sourcePath: string;
      minify: boolean;
      sourceMap: boolean;
    };
    const engine = createTestCSSOptimizationEngine((received) => {
      mutableRequest.css = "mutated";
      assertEquals(received.css, request.css);
      assert(Object.isFrozen(received));
      return { css: received.css };
    });

    runCSSOptimizationEngine(engine, mutableRequest);
  });

  it("rejects request accessors and unsupported iterable state without invoking it", () => {
    let accessorCalls = 0;
    let iteratorCalls = 0;
    let invoked = false;
    const engine = createTestCSSOptimizationEngine(() => {
      invoked = true;
      return { css: "" };
    });
    const accessorRequest = { ...request } as Record<string, unknown>;
    Object.defineProperty(accessorRequest, "css", {
      enumerable: true,
      get() {
        accessorCalls++;
        return request.css;
      },
    });
    assertThrows(
      () => runCSSOptimizationEngine(engine, accessorRequest as never),
      TypeError,
      "css must be a data property",
    );
    assertEquals(accessorCalls, 0);

    const hostileQueries = ["defaults"];
    Object.defineProperty(hostileQueries, Symbol.iterator, {
      value() {
        iteratorCalls++;
        throw new Error("must not iterate");
      },
    });
    assertThrows(
      () =>
        runCSSOptimizationEngine(engine, {
          ...request,
          browserQueries: hostileQueries,
        } as never),
      TypeError,
      "unsupported properties",
    );
    assertEquals(iteratorCalls, 0);
    assertEquals(invoked, false);
  });

  it("rejects malformed engine and result shapes", () => {
    assertThrows(
      () =>
        runCSSOptimizationEngine(
          { cacheIdentity: "", optimize: () => ({ css: "" }) },
          request,
        ),
      TypeError,
      "cacheIdentity",
    );
    assertThrows(
      () =>
        runCSSOptimizationEngine(
          createTestCSSOptimizationEngine(
            (() => Promise.resolve({ css: "" })) as never,
          ),
          request,
        ),
      TypeError,
      "result must define css",
    );
    assertThrows(
      () =>
        runCSSOptimizationEngine(
          createTestCSSOptimizationEngine(() => ({
            get css(): string {
              throw new Error("hostile getter");
            },
          })),
          request,
        ),
      TypeError,
      "css must be a data property",
    );
  });

  it("enforces requested source-map semantics and version", () => {
    const mappedRequest = { ...request, sourceMap: true };
    assertThrows(
      () =>
        runCSSOptimizationEngine(
          createTestCSSOptimizationEngine(() => ({ css: "ok" })),
          mappedRequest,
        ),
      TypeError,
      "requested source map",
    );
    assertThrows(
      () =>
        runCSSOptimizationEngine(
          createTestCSSOptimizationEngine(() => ({
            css: "ok",
            sourceMap: createTestCSSSourceMap("field.css"),
          })),
          request,
        ),
      TypeError,
      "unrequested source map",
    );
    assertThrows(
      () =>
        runCSSOptimizationEngine(
          createTestCSSOptimizationEngine(() => ({
            css: "ok",
            sourceMap: JSON.stringify({ version: 2 }),
          })),
          mappedRequest,
        ),
      TypeError,
      "source map is invalid",
    );
    assertThrows(
      () =>
        runCSSOptimizationEngine(
          createTestCSSOptimizationEngine(() => ({
            css: "ok",
            sourceMap: "not-json",
          })),
          mappedRequest,
        ),
      TypeError,
      "source map is malformed",
    );
    assertThrows(
      () =>
        runCSSOptimizationEngine(
          createTestCSSOptimizationEngine(() => ({
            css: "ok",
            sourceMap: "x".repeat(MAX_CSS_OUTPUT_FILE_BYTES + 1),
          })),
          mappedRequest,
        ),
      TypeError,
      "source map exceeds",
    );
  });

  it("enforces the complete flat source-map v3 structure at the boundary", () => {
    const mappedRequest = { ...request, sourceMap: true };
    for (
      const sourceMap of [
        JSON.stringify({
          version: 3,
          sources: [],
          names: [],
          mappings: "AAAA",
        }),
        JSON.stringify({
          version: 3,
          sources: ["../escape.css"],
          names: [],
          mappings: "AAAA",
        }),
        JSON.stringify({
          version: 3,
          sources: ["field.css"],
          names: [],
          mappings: "not valid!",
        }),
        JSON.stringify({
          version: 3,
          sources: ["field.css"],
          names: [],
          mappings: "g",
        }),
        JSON.stringify({
          version: 3,
          sources: ["field.css"],
          names: [],
          mappings: ",",
        }),
        JSON.stringify({
          version: 3,
          sources: ["field.css"],
          names: [],
          mappings: "AAAAAA",
        }),
        JSON.stringify({
          version: 3,
          sources: ["field.css"],
          names: [],
          mappings: "D",
        }),
        JSON.stringify({
          version: 3,
          sources: ["field.css"],
          names: [],
          mappings: "AAAA",
          sourcesContent: [],
        }),
        JSON.stringify({
          version: 3,
          sources: ["field.css"],
          names: [],
          mappings: "AAAA",
          unknown: true,
        }),
      ]
    ) {
      assertThrows(
        () =>
          runCSSOptimizationEngine(
            createTestCSSOptimizationEngine(() => ({ css: "ok", sourceMap })),
            mappedRequest,
          ),
        TypeError,
        "source map is invalid",
      );
    }
  });

  it("rejects oversized output and preserves engine failures", () => {
    assertThrows(
      () =>
        runCSSOptimizationEngine(
          createTestCSSOptimizationEngine(() => ({
            css: "x".repeat(MAX_CSS_OUTPUT_FILE_BYTES + 1),
          })),
          request,
        ),
      TypeError,
      "CSS output exceeds",
    );

    const failure = new Error("engine failed");
    const engine = createTestCSSOptimizationEngine(() => {
      throw failure;
    });
    let thrown: unknown;
    try {
      runCSSOptimizationEngine(engine, request);
    } catch (error) {
      thrown = error;
    }
    assertEquals(thrown, failure);
  });

  it("captures engine properties once for identity and every session run", () => {
    let optimizeReads = 0;
    let cacheIdentityReads = 0;
    let calls = 0;
    const engine = Object.create(null) as CSSOptimizationEngine;
    Object.defineProperty(engine, "cacheIdentity", {
      enumerable: true,
      get() {
        cacheIdentityReads++;
        return "hostile";
      },
    });
    Object.defineProperty(engine, "optimize", {
      enumerable: true,
      get() {
        optimizeReads++;
        return () => ({ css: "" });
      },
    });
    assertThrows(
      () => createCSSOptimizationSession(engine),
      TypeError,
      "cacheIdentity must be an own data property",
    );
    assertEquals(cacheIdentityReads, 0);
    assertEquals(optimizeReads, 0);

    const stable = createTestCSSOptimizationEngine((input) => {
      calls++;
      return { css: input.css };
    }, "stable@1");
    const session = createCSSOptimizationSession(stable);
    (stable as { cacheIdentity: string }).cacheIdentity = "mutated";
    (stable as { optimize: CSSOptimizationEngine["optimize"] }).optimize = () => ({
      css: "wrong",
    });
    assertEquals(session.cacheIdentity, "stable@1");
    assertEquals(session.run(request).css, request.css);
    assertEquals(session.run(request).css, request.css);
    assertEquals(calls, 2);
  });
});
