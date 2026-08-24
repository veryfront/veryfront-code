import "#veryfront/schemas/_test-setup.ts";
import type { CSSOptimizationEngine } from "#veryfront/extensions/css/index.ts";
import { CSSOptimizationEngineName } from "#veryfront/extensions/css/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createTestCSSOptimizationEngine,
  createTestCSSSourceMap,
} from "../../../../tests/_helpers/css-optimization-engine.ts";
import { MAX_CSS_FILE_BYTES, MAX_CSS_OUTPUT_FILE_BYTES } from "./constants.ts";
import {
  acquireConfiguredCSSOptimization,
  createCSSOptimizationSession,
  runConfiguredCSSOptimization,
  runCSSOptimizationEngine,
  validateCSSSourceMap,
} from "./optimization-engine.ts";
import { basicMinify } from "./utils.ts";

const request = {
  css: ".field { color: red; }",
  sourcePath: "field.css",
  minify: true,
  sourceMap: false,
} as const;

describe("CSS optimization engine boundary", () => {
  it("keeps basicMinify synchronous and delegates without a fallback", () => {
    const previous = tryResolve<CSSOptimizationEngine>(
      CSSOptimizationEngineName,
    );
    unregister(CSSOptimizationEngineName);
    register(
      CSSOptimizationEngineName,
      createTestCSSOptimizationEngine((received) => {
        assertEquals(received, {
          css: request.css,
          sourcePath: "inline.css",
          minify: true,
          sourceMap: false,
        });
        return { css: ".field{color:red}" };
      }),
    );
    try {
      const result = basicMinify(request.css);
      assertEquals(result, ".field{color:red}");
      assertEquals(typeof result, "string");
    } finally {
      unregister(CSSOptimizationEngineName);
      if (previous !== undefined) {
        register(CSSOptimizationEngineName, previous);
      }
    }
  });

  it("fails closed with the recommended extension when no engine is composed", () => {
    const previous = tryResolve<CSSOptimizationEngine>(
      CSSOptimizationEngineName,
    );
    unregister(CSSOptimizationEngineName);
    try {
      assertThrows(
        () => runConfiguredCSSOptimization(request),
        Error,
        "deno add @veryfront/ext-css-lightning",
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

    assertEquals(runCSSOptimizationEngine(engine, mutableRequest).css, request.css);
  });

  it("rejects request accessors, proxies, and unsupported state without invocation", () => {
    let accessorCalls = 0;
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

    const trapped = new Proxy({ ...request }, {
      ownKeys() {
        throw new Error("blocked");
      },
    });
    assertThrows(
      () => runCSSOptimizationEngine(engine, trapped),
      TypeError,
      "could not be inspected",
    );
    assertThrows(
      () =>
        runCSSOptimizationEngine(engine, {
          ...request,
          browserQueries: ["defaults"],
        } as never),
      TypeError,
      "unsupported properties",
    );
    assertEquals(invoked, false);
  });

  it("enforces canonical request values and input bounds", () => {
    const engine = createTestCSSOptimizationEngine();
    for (
      const sourcePath of [
        "",
        "/absolute.css",
        "../escape.css",
        "./field.css",
        "styles//field.css",
        "styles\\field.css",
        "C:\\field.css",
        "decomposed-e\u0301.css",
        "line\nbreak.css",
        "line\u2028break.css",
        "unpaired\uD800.css",
      ]
    ) {
      assertThrows(
        () => runCSSOptimizationEngine(engine, { ...request, sourcePath }),
        TypeError,
        "safe canonical",
      );
    }
    assertThrows(
      () =>
        runCSSOptimizationEngine(engine, {
          ...request,
          css: "x".repeat(MAX_CSS_FILE_BYTES + 1),
        }),
      TypeError,
      "CSS input exceeds",
    );
    assertThrows(
      () =>
        runCSSOptimizationEngine(engine, {
          ...request,
          css: "unpaired\uD800",
        }),
      TypeError,
      "well-formed string",
    );
  });

  it("rejects malformed engine and result shapes without invoking getters", () => {
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
      "must define css",
    );

    let resultReads = 0;
    assertThrows(
      () =>
        runCSSOptimizationEngine(
          createTestCSSOptimizationEngine(() =>
            Object.defineProperty({}, "css", {
              get() {
                resultReads++;
                return "hostile";
              },
            }) as never
          ),
          request,
        ),
      TypeError,
      "css must be a data property",
    );
    assertEquals(resultReads, 0);

    assertThrows(
      () =>
        runCSSOptimizationEngine(
          createTestCSSOptimizationEngine(() =>
            ({
              css: "ok",
              ignored: true,
            }) as never
          ),
          request,
        ),
      TypeError,
      "unsupported properties",
    );

    let sourceMapReads = 0;
    const accessorResult = { css: "ok" } as Record<string, unknown>;
    Object.defineProperty(accessorResult, "sourceMap", {
      get() {
        sourceMapReads++;
        return undefined;
      },
    });
    assertThrows(
      () =>
        runCSSOptimizationEngine(
          createTestCSSOptimizationEngine(() => accessorResult as never),
          request,
        ),
      TypeError,
      "sourceMap must be a data property",
    );
    assertEquals(sourceMapReads, 0);
  });

  it("enforces requested source-map semantics and complete flat v3 shape", () => {
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
          mappings: "B",
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
        JSON.stringify({
          version: 3,
          sources: ["field.css"],
          names: ["a\u0000b"],
          mappings: "AAAA",
        }),
        JSON.stringify({
          version: 3,
          sources: ["field.css"],
          names: [],
          mappings: "AAAAA",
        }),
        JSON.stringify({
          version: 3,
          sources: ["field.css"],
          names: [],
          mappings: "AAAA",
          file: "../escape.css",
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

  it("accepts valid source maps and freezes validated output", () => {
    const sourceMap = JSON.stringify({
      version: 3,
      sources: ["field.css"],
      names: ["selector"],
      mappings: "AAAAA",
      file: "field.css",
      sourceRoot: "",
      ignoreList: [0],
      x_google_ignoreList: [0],
    });
    validateCSSSourceMap(sourceMap, "field.css");
    const result = runCSSOptimizationEngine(
      createTestCSSOptimizationEngine(() => ({ css: "ok", sourceMap })),
      { ...request, sourceMap: true },
    );
    assertEquals(result, { css: "ok", sourceMap });
    assertEquals(Object.isFrozen(result), true);
  });

  it("rejects oversized output and preserves provider failures", () => {
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

  it("captures one immutable provider session per operation", () => {
    let firstCalls = 0;
    let secondCalls = 0;
    const first = createTestCSSOptimizationEngine((input) => {
      firstCalls++;
      return { css: `first:${input.css}` };
    }, "first@1");
    const second = createTestCSSOptimizationEngine((input) => {
      secondCalls++;
      return { css: `second:${input.css}` };
    }, "second@1");

    const previous = tryResolve<CSSOptimizationEngine>(
      CSSOptimizationEngineName,
    );
    unregister(CSSOptimizationEngineName);
    try {
      register(CSSOptimizationEngineName, first);
      const firstSession = acquireConfiguredCSSOptimization();
      unregister(CSSOptimizationEngineName);
      register(CSSOptimizationEngineName, second);
      const secondSession = acquireConfiguredCSSOptimization();

      assertEquals(firstSession.cacheIdentity, "first@1");
      assertEquals(secondSession.cacheIdentity, "second@1");
      assertEquals(firstSession.run(request).css, `first:${request.css}`);
      assertEquals(secondSession.run(request).css, `second:${request.css}`);
      assertEquals(firstCalls, 1);
      assertEquals(secondCalls, 1);
    } finally {
      unregister(CSSOptimizationEngineName);
      if (previous !== undefined) register(CSSOptimizationEngineName, previous);
    }
  });

  it("uses captured validation and invocation intrinsics", () => {
    const sourceMap = createTestCSSSourceMap(request.sourcePath);
    const session = createCSSOptimizationSession(
      createTestCSSOptimizationEngine((input) => ({
        css: input.css,
        ...(input.sourceMap ? { sourceMap } : {}),
      })),
    );
    const originalApply = Reflect.apply;
    const originalEncode = TextEncoder.prototype.encode;
    const originalNormalize = String.prototype.normalize;
    const originalFloor = Math.floor;
    const originalArrayToJSON = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "toJSON",
    );
    let result: string | undefined;
    try {
      Reflect.apply = () => {
        throw new Error("poisoned apply");
      };
      TextEncoder.prototype.encode = () => {
        throw new Error("poisoned encode");
      };
      String.prototype.normalize = () => {
        throw new Error("poisoned normalize");
      };
      Math.floor = () => {
        throw new Error("poisoned floor");
      };
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value() {
          throw new Error("poisoned toJSON");
        },
      });
      result = session.run({ ...request, sourceMap: true }).css;
    } finally {
      Reflect.apply = originalApply;
      TextEncoder.prototype.encode = originalEncode;
      String.prototype.normalize = originalNormalize;
      Math.floor = originalFloor;
      if (originalArrayToJSON === undefined) {
        delete (Array.prototype as unknown as Record<string, unknown>).toJSON;
      } else {
        Object.defineProperty(
          Array.prototype,
          "toJSON",
          originalArrayToJSON,
        );
      }
    }
    assertEquals(result, request.css);
  });
});
