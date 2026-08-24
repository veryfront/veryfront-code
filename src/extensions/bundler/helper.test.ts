import "#veryfront/schemas/_test-setup.ts";
/**
 * Runtime-boundary tests for bundler convenience helpers.
 *
 * @module extensions/bundler/helper.test
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "../contracts.ts";
import type { BundleOptions, Bundler, TransformOptions } from "./bundler.ts";
import { context, stop, transform } from "./helper.ts";

it("transform keeps the positional source authoritative over runtime options", async () => {
  const previous = tryResolve<Bundler>("Bundler");
  let received: TransformOptions | undefined;
  register<Bundler>("Bundler", {
    bundle: () => Promise.resolve({ outputFiles: [], warnings: [], errors: [] }),
    transform(options) {
      received = options;
      return Promise.resolve({ code: options.code, warnings: [] });
    },
  });

  try {
    const result = await transform("authoritative source", {
      code: "runtime override",
      loader: "ts",
    });

    assertEquals(result.code, "authoritative source");
    assertEquals(received, {
      code: "authoritative source",
      loader: "ts",
    });
  } finally {
    unregister("Bundler");
    if (previous !== undefined) register("Bundler", previous);
  }
});

it("stop() forwards to the registered bundler teardown exactly once and tolerates its absence", async () => {
  const previous = tryResolve<Bundler>("Bundler");
  let stopCalls = 0;
  const bundle = () => Promise.resolve({ outputFiles: [], warnings: [], errors: [] });
  const transformStub: Bundler["transform"] = (options) =>
    Promise.resolve({ code: options.code, warnings: [] });

  try {
    register<Bundler>("Bundler", {
      bundle,
      transform: transformStub,
      stop() {
        stopCalls++;
        return Promise.resolve();
      },
    });
    await stop();
    assertEquals(stopCalls, 1, "helper.stop() must invoke the registered bundler's stop()");

    unregister("Bundler");
    register<Bundler>("Bundler", { bundle, transform: transformStub });
    await stop();
    assertEquals(stopCalls, 1, "a bundler without stop() must leave the counter untouched");
  } finally {
    unregister("Bundler");
    if (previous !== undefined) register("Bundler", previous);
  }
});

it("context() reports a bundler without incremental support", () => {
  const previous = tryResolve<Bundler>("Bundler");
  try {
    register<Bundler>("Bundler", {
      bundle: () => Promise.resolve({ outputFiles: [], warnings: [], errors: [] }),
      transform: (options) => Promise.resolve({ code: options.code, warnings: [] }),
    });

    assertThrows(
      () => context({} as BundleOptions),
      Error,
      "does not support context()",
      "a bundler without context() must fail with the capability error, not a TypeError",
    );
  } finally {
    unregister("Bundler");
    if (previous !== undefined) register("Bundler", previous);
  }
});
