import "#veryfront/schemas/_test-setup.ts";
/**
 * Runtime-boundary tests for bundler convenience helpers.
 *
 * @module extensions/bundler/helper.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "../contracts.ts";
import type { Bundler, TransformOptions } from "./bundler.ts";
import { transform } from "./helper.ts";

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
