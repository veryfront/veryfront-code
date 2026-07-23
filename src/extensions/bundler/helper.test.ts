import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "../contracts.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import type { BundleOptions, Bundler, TransformOptions } from "./bundler.ts";
import { build, context, getBundler, transform } from "./helper.ts";

function replaceBundler(value: unknown): () => void {
  const previous = tryResolve<unknown>("Bundler");
  register("Bundler", value);
  return () => {
    if (previous === undefined) unregister("Bundler");
    else register("Bundler", previous);
  };
}

describe("extensions/bundler helper", () => {
  it("keeps the positional transform source authoritative", async () => {
    let received: TransformOptions | undefined;
    const bundler: Bundler = {
      bundle: (_options: BundleOptions) =>
        Promise.resolve({ outputFiles: [], warnings: [], errors: [] }),
      transform: (options) => {
        received = options;
        return Promise.resolve({ code: options.code, warnings: [] });
      },
    };
    const restore = replaceBundler(bundler);

    try {
      const untypedOptions = { code: "untrusted override", loader: "ts" } as unknown as Omit<
        TransformOptions,
        "code"
      >;
      const result = await transform("authoritative source", untypedOptions);

      assertEquals(received?.code, "authoritative source");
      assertEquals(result.code, "authoritative source");
    } finally {
      restore();
    }
  });

  it("snapshots a provider method once for each helper operation", async () => {
    let bundleReads = 0;
    const provider = {
      get bundle() {
        bundleReads++;
        return (_options: BundleOptions) =>
          Promise.resolve({ outputFiles: [], warnings: [], errors: [] });
      },
      transform: (options: TransformOptions) =>
        Promise.resolve({ code: options.code, warnings: [] }),
    };
    const restore = replaceBundler(provider);

    try {
      await build({ write: false });
      assertEquals(bundleReads, 1);
    } finally {
      restore();
    }
  });

  it("rejects malformed registered bundlers at the resolution boundary", () => {
    const restore = replaceBundler({ bundle: "not callable", transform: () => Promise.resolve() });

    try {
      let error: unknown;
      try {
        getBundler();
      } catch (caught) {
        error = caught;
      }
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "extension-validation");
      assertEquals(error.message, "Registered Bundler contract is invalid");
    } finally {
      restore();
    }
  });

  it("uses a typed error when incremental contexts are unsupported", () => {
    const bundler: Bundler = {
      bundle: () => Promise.resolve({ outputFiles: [], warnings: [], errors: [] }),
      transform: (options) => Promise.resolve({ code: options.code, warnings: [] }),
    };
    const restore = replaceBundler(bundler);

    try {
      let error: unknown;
      try {
        context({ write: false });
      } catch (caught) {
        error = caught;
      }
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "not-supported");
      assertEquals(error.message, "Registered Bundler does not support incremental builds");
    } finally {
      restore();
    }
  });
});
