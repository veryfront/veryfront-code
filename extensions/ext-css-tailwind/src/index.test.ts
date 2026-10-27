import vendorSources from "../vendor-sources.json" with { type: "json" };
import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createHash } from "node:crypto";
import tailwindPackage from "tailwindcss/package.json" with { type: "json" };
import extensionPackage from "../deno.json" with { type: "json" };
import factory, { TAILWIND_DEFAULT_STYLESHEET, TailwindCSSProcessor } from "./index.ts";
import { exactTailwindVersion } from "./manifest-dependency.ts";
import { TAILWIND_PLUGIN_POLICY_IDENTITY } from "./plugin-policy.ts";

import { TW_ANIMATE_CSS } from "../vendor/tw-animate-css.js";

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };

describe("ext-css-tailwind", () => {
  it("aligns package, factory, contract, and capability metadata", () => {
    const extension = factory();
    assertEquals(extensionPackage.veryfront.activation, "auto");
    assertEquals(extension.name, "ext-css-tailwind");
    assertEquals(extension.version, extensionPackage.version);
    assertEquals(extension.contracts?.provides, ["CSSProcessor"]);
    assertEquals(extension.capabilities, [{ type: "fs:read" }]);
  });

  it("binds cache identity to extension, compiler, base CSS, and plugin policy", () => {
    const processor = new TailwindCSSProcessor();
    const identity = processor.cacheIdentity;
    assertEquals(processor.defaultStylesheet, TAILWIND_DEFAULT_STYLESHEET);
    assertEquals(Object.isFrozen(processor), true);
    assertEquals(Object.isFrozen(TailwindCSSProcessor.prototype), true);
    assertEquals(Object.isFrozen(TailwindCSSProcessor), true);
    assertStringIncludes(identity, `ext-css-tailwind@${extensionPackage.version}`);
    assertEquals(
      exactTailwindVersion(extensionPackage.imports.tailwindcss),
      tailwindPackage.version,
    );
    assertStringIncludes(identity, `tailwindcss@${tailwindPackage.version}`);
    assertStringIncludes(identity, "base=");
    assertStringIncludes(
      identity,
      `vendor=${createHash("sha256").update(JSON.stringify(vendorSources), "utf8").digest("hex")}`,
    );
    assertStringIncludes(
      identity,
      `plugins=${
        createHash("sha256").update(TAILWIND_PLUGIN_POLICY_IDENTITY, "utf8").digest("hex")
      }`,
    );
    assertEquals(identity.includes("https://"), false);
  });

  it("rejects an unpinned or structurally different Tailwind manifest import", () => {
    for (
      const specifier of [
        undefined,
        "tailwindcss@4.2.2",
        "npm:other-package@4.2.2",
        "npm:tailwindcss@^4.2.2",
        "npm:tailwindcss@4.2",
        "npm:tailwindcss@04.2.2",
        "npm:tailwindcss@4.2.2-01",
        "npm:tailwindcss@4.2.2/index.css",
      ]
    ) {
      assertThrows(() => exactTailwindVersion(specifier), TypeError);
    }
  });

  it("registers a processor without persistent plugin globals", async () => {
    const provided = new Map<string, unknown>();
    const global = globalThis as Record<string, unknown>;
    delete global.__tailwindPluginShim;
    delete global.__tailwindDefaultThemeShim;
    delete global.__tailwindColorsShim;
    await factory().setup?.({
      config: {},
      logger: noopLogger,
      provide: (name, implementation) => provided.set(name, implementation),
      get: () => undefined,
      require: () => {
        throw new Error("not used");
      },
    });
    assertEquals(provided.get("CSSProcessor") instanceof TailwindCSSProcessor, true);
    assertEquals(global.__tailwindPluginShim, undefined);
    assertEquals(global.__tailwindDefaultThemeShim, undefined);
    assertEquals(global.__tailwindColorsShim, undefined);
  });

  it("compiles using its local base stylesheet without network fallback", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      return Promise.reject(new Error("base compilation must not fetch"));
    }) as typeof fetch;
    try {
      const compiler = await new TailwindCSSProcessor().compile('@import "tailwindcss";');
      const css = compiler.build(["text-red-500"]);
      assertEquals(css.includes(".text-red-500"), true);
      assertEquals(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("compiles pinned animation CSS and binds its exact bytes to the cache", async () => {
    const processor = new TailwindCSSProcessor();
    const hash = createHash("sha256").update(TW_ANIMATE_CSS, "utf8").digest("hex");
    assertEquals(hash, "6035b41301945cd65eb233b4653965e3c235338faae51b0f55676d591daaef23");
    assertStringIncludes(processor.cacheIdentity, `tw-animate-css@1.4.0=${hash}`);
    assertEquals(extensionPackage.imports["tw-animate-css"], "npm:tw-animate-css@1.4.0");
    const compiler = await processor.compile('@import "tailwindcss";\n@import "tw-animate-css";');
    const css = compiler.build(["animate-in", "fade-in", "zoom-in-95", "slide-in-from-top-2"]);
    for (
      const expected of [
        ".animate-in",
        ".fade-in",
        ".zoom-in-95",
        ".slide-in-from-top-2",
        "@keyframes enter",
      ]
    ) {
      assertStringIncludes(css, expected);
    }
    assertEquals(
      compiler.build(["animate-in", "fade-in", "zoom-in-95", "slide-in-from-top-2"]),
      css,
    );
    for (
      const specifier of [
        "tw-animate-css@1.3.0",
        "tw-animate-css/prefix",
        "../animation.css",
      ]
    ) {
      await assertRejects(
        () => processor.compile(`@import "${specifier}";`),
        Error,
        "cannot resolve stylesheet import",
      );
    }
  });

  it("rejects unknown stylesheet imports and inherited factory config", async () => {
    await assertRejects(
      () => new TailwindCSSProcessor().compile('@import "unknown-css-package";'),
      Error,
      "cannot resolve stylesheet import",
    );
    assertThrows(
      () => factory(Object.create({ option: true })),
      TypeError,
      "must not inherit",
    );
  });
});
