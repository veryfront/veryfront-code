import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertCSSProcessor,
  captureCSSCompiler,
  captureCSSProcessor,
  type CSSProcessor,
  MAX_CSS_PROCESSOR_DEFAULT_STYLESHEET_CHARACTERS,
  MAX_CSS_PROCESSOR_IDENTITY_CHARACTERS,
} from "./css-processor.ts";

interface StatefulCSSProcessor extends CSSProcessor {
  readonly marker: string;
}

function processor(): StatefulCSSProcessor {
  return {
    cacheIdentity: "test-css-processor@1",
    defaultStylesheet: '@import "test";',
    marker: "captured",
    compile(stylesheet) {
      const marker = this.marker;
      return Promise.resolve({
        build(candidates) {
          return `${marker}:${stylesheet}:${candidates.join(",")}`;
        },
      });
    },
  };
}

describe("CSSProcessor contract", () => {
  it("captures identity, default stylesheet, method, implementation, and compiler once", async () => {
    const value = processor();
    const captured = captureCSSProcessor(value);
    (value as { cacheIdentity: string }).cacheIdentity = "mutated";
    (value as { defaultStylesheet: string }).defaultStylesheet = "mutated";
    value.compile = () => Promise.resolve({ build: () => "replacement" });

    const compiler = await captured.compile("input.css");
    assertEquals(captured.cacheIdentity, "test-css-processor@1");
    assertEquals(captured.defaultStylesheet, '@import "test";');
    assertEquals(compiler.build(["alpha", "beta"]), "captured:input.css:alpha,beta");
  });

  it("captures a prototype-defined compile from a class implementation", async () => {
    // The first-party Tailwind processor is a class instance: `compile` lives on
    // the prototype, so an own-property lookup would reject it outright.
    class ClassCSSProcessor {
      cacheIdentity = "class-css-processor@1";
      defaultStylesheet = '@import "test";';
      marker = "captured";
      compile(stylesheet: string) {
        const marker = this.marker;
        return Promise.resolve({
          build: (candidates: string[]) => `${marker}:${stylesheet}:${candidates.join(",")}`,
        });
      }
    }

    const instance = new ClassCSSProcessor();
    const captured = captureCSSProcessor(instance);
    const compiler = await captured.compile("input.css");

    assertEquals(
      compiler.build(["alpha"]),
      "captured:input.css:alpha",
      "a prototype-defined compile must be captured and invoked with the instance as this",
    );
  });

  it("rejects property accessors and Proxies without invoking their hooks", () => {
    let identityReads = 0;
    const accessor = Object.defineProperty(
      {
        defaultStylesheet: "input.css",
        compile: processor().compile,
      },
      "cacheIdentity",
      {
        get() {
          identityReads++;
          return "hostile@1";
        },
      },
    );
    assertThrows(() => assertCSSProcessor(accessor), TypeError, "own data property");
    assertEquals(identityReads, 0);

    let proxyHooks = 0;
    const proxy = new Proxy(processor(), {
      getOwnPropertyDescriptor() {
        proxyHooks++;
        throw new Error("must not run");
      },
      getPrototypeOf() {
        proxyHooks++;
        throw new Error("must not run");
      },
    });
    assertThrows(() => assertCSSProcessor(proxy), TypeError, "non-Proxy object");
    assertEquals(proxyHooks, 0);
  });

  it("rejects compiler accessors without invoking them and validates build output", () => {
    let buildReads = 0;
    const accessor = Object.defineProperty({}, "build", {
      get() {
        buildReads++;
        return () => "hostile";
      },
    });
    assertThrows(() => captureCSSCompiler(accessor), TypeError, "data-property function");
    assertEquals(buildReads, 0);

    const invalid = captureCSSCompiler({ build: () => 123 as unknown as string });
    assertThrows(() => invalid.build([]), TypeError, "return CSS as a string");
  });

  it("rejects unstable identities and unbounded or NUL-containing defaults", () => {
    for (
      const cacheIdentity of [
        "",
        " padded ",
        "line\nbreak",
        "x".repeat(MAX_CSS_PROCESSOR_IDENTITY_CHARACTERS + 1),
      ]
    ) {
      assertThrows(
        () => assertCSSProcessor({ ...processor(), cacheIdentity }),
        TypeError,
        "bounded stable cacheIdentity",
      );
    }

    for (
      const defaultStylesheet of [
        "contains\0nul",
        "x".repeat(MAX_CSS_PROCESSOR_DEFAULT_STYLESHEET_CHARACTERS + 1),
      ]
    ) {
      assertThrows(
        () => assertCSSProcessor({ ...processor(), defaultStylesheet }),
        TypeError,
        "bounded defaultStylesheet",
      );
    }
  });

  it("uses captured inspection and invocation intrinsics", async () => {
    const originalIndexOf = String.prototype.indexOf;
    const originalApply = Reflect.apply;
    let invalidDefaultError: unknown;
    let css: string | undefined;
    try {
      String.prototype.indexOf = () => -1;
      Reflect.apply = () => {
        throw new Error("poisoned Reflect.apply");
      };
      try {
        assertCSSProcessor({ ...processor(), defaultStylesheet: "contains\0nul" });
      } catch (error) {
        invalidDefaultError = error;
      }
      css = (await captureCSSProcessor(processor()).compile("input.css")).build(["alpha"]);
    } finally {
      String.prototype.indexOf = originalIndexOf;
      Reflect.apply = originalApply;
    }

    assertEquals(invalidDefaultError instanceof TypeError, true);
    assertEquals(css, "captured:input.css:alpha");
  });
});
