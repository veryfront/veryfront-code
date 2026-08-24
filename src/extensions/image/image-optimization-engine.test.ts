import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertImageOptimizationEngine,
  captureImageOptimizationEngine,
  type ImageOptimizationEngine,
  MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
} from "./image-optimization-engine.ts";

function engine(): ImageOptimizationEngine {
  return {
    cacheIdentity: "test-image-engine@1",
    optimize: () =>
      Promise.resolve({
        sourceWidth: 1,
        sourceHeight: 1,
        variants: [{
          format: "png",
          width: 1,
          height: 1,
          data: new Uint8Array([1]),
        }],
      }),
  };
}

describe("ImageOptimizationEngine contract", () => {
  it("accepts and captures a provider-neutral engine", async () => {
    const value = engine();
    assertImageOptimizationEngine(value);
    const captured = captureImageOptimizationEngine(value);
    (value as { cacheIdentity: string }).cacheIdentity = "mutated";
    value.optimize = () => Promise.reject(new Error("mutated"));

    assertEquals(captured.cacheIdentity, "test-image-engine@1");
    assertEquals(
      (await captured.optimize({
        input: new Uint8Array([1]),
        targetWidths: Object.freeze([1]),
        formats: Object.freeze(["png"]),
        quality: 80,
        signal: new AbortController().signal,
      })).sourceWidth,
      1,
    );
  });

  it("rejects accessors without invoking them", () => {
    let calls = 0;
    const value = Object.defineProperty({}, "cacheIdentity", {
      enumerable: true,
      get() {
        calls++;
        return "hostile";
      },
    });
    Object.defineProperty(value, "optimize", {
      enumerable: true,
      value: engine().optimize,
    });

    assertThrows(() => assertImageOptimizationEngine(value), TypeError);
    assertEquals(calls, 0);
  });

  it("does not consult a replacement method after capture", async () => {
    const value = engine();
    const captured = captureImageOptimizationEngine(value);
    value.optimize = () => Promise.reject(new Error("replacement invoked"));
    await captured.optimize({
      input: new Uint8Array([1]),
      targetWidths: Object.freeze([1]),
      formats: Object.freeze(["png"]),
      quality: 80,
      signal: new AbortController().signal,
    });
    await assertRejects(
      () =>
        value.optimize({
          input: new Uint8Array([1]),
          targetWidths: [],
          formats: [],
          quality: 80,
          signal: new AbortController().signal,
        }),
      Error,
      "replacement invoked",
    );
  });

  it("rejects a prototype-inherited cacheIdentity but accepts an inherited optimize", async () => {
    // The asymmetry is deliberate: a shared prototype must not supply one cache
    // identity to differently configured instances, while a class implementation
    // may still define optimize() on its prototype.
    assertThrows(
      () =>
        assertImageOptimizationEngine(
          Object.assign(Object.create({ cacheIdentity: "inherited@1" }), {
            optimize: engine().optimize,
          }),
        ),
      TypeError,
      "cacheIdentity must be an own data property",
      "cacheIdentity must be owned by the engine instance, not inherited",
    );

    const inheritedOptimize = Object.assign(
      Object.create({ optimize: engine().optimize }),
      { cacheIdentity: "prototype-optimize@1" },
    );
    const captured = captureImageOptimizationEngine(inheritedOptimize);
    assertEquals(
      (await captured.optimize({
        input: new Uint8Array([1]),
        targetWidths: Object.freeze([1]),
        formats: Object.freeze(["png"]),
        quality: 80,
        signal: new AbortController().signal,
      })).sourceWidth,
      1,
      "a prototype-defined optimize must still be captured",
    );
  });

  it("rejects unstable and oversized identities", () => {
    for (
      const cacheIdentity of [
        "",
        " padded ",
        "x".repeat(MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS + 1),
      ]
    ) {
      assertThrows(
        () => assertImageOptimizationEngine({ ...engine(), cacheIdentity }),
        TypeError,
        "bounded stable cacheIdentity",
      );
    }
  });
});
