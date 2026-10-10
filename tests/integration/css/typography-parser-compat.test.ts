import { loadPlugin } from "../../../extensions/ext-css-tailwind/src/plugin-loader.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import {
  TAILWIND_DEFAULT_STYLESHEET,
  TailwindCSSProcessor,
} from "../../../extensions/ext-css-tailwind/src/index.ts";

const marker = "selector-boundary-sentinel";
const cases: ReadonlyArray<readonly [string, string]> = [
  ["default", TAILWIND_DEFAULT_STYLESHEET],
  ["raw-rule", TAILWIND_DEFAULT_STYLESHEET + `\n.${marker} { color: red; }`],
  [
    "class-option",
    `@import "tailwindcss";\n@plugin "@tailwindcss/typography" { className: ${marker}; }`,
  ],
  [
    "theme-primitive",
    TAILWIND_DEFAULT_STYLESHEET + `\n@theme { --typography-${marker}: red; }`,
  ],
  [
    "theme-path",
    TAILWIND_DEFAULT_STYLESHEET +
    `\n@theme { --typography-DEFAULT-css-${marker}: red; }`,
  ],
  [
    "theme-base-primitive",
    TAILWIND_DEFAULT_STYLESHEET + `\n@theme { --typography: red; }`,
  ],
  [
    "theme-prototype-tuple",
    TAILWIND_DEFAULT_STYLESHEET +
    `\n@theme { --typography-__proto__: red; --typography-__proto__--css: ${marker}; }`,
  ],
  [
    "theme-tuple",
    TAILWIND_DEFAULT_STYLESHEET +
    `\n@theme { --typography-DEFAULT: red; --typography-DEFAULT--css-${marker}: blue; }`,
  ],
];

// Exact outputs captured from unmodified upstream Typography0.5.19/parser6.0.10.
const expected = [
  "39a786a5f4699f21928a1c47cd381e6783bc18d7ec13e492d93606f904cddc6f",
  "5e5f473a1bcec48a334fed2f06cbe76c1b929da7f461a456c7039e14a3786e17",
  "b3c5ff971fa243652178fe0e0d0c85735d37e106b39699e2d819ee4ea737abd5",
  "39a786a5f4699f21928a1c47cd381e6783bc18d7ec13e492d93606f904cddc6f",
  "39a786a5f4699f21928a1c47cd381e6783bc18d7ec13e492d93606f904cddc6f",
  "14d261f9598d3de4e5a6db676fab6eff6b99b4f636c8b87a51b9e127d97f7862",
  "39a786a5f4699f21928a1c47cd381e6783bc18d7ec13e492d93606f904cddc6f",
  "39a786a5f4699f21928a1c47cd381e6783bc18d7ec13e492d93606f904cddc6f",
];
Deno.test("parser-patched Typography preserves upstream CSS output", async (t) => {
  for (const [index, [name, css]] of cases.entries()) {
    await t.step(name, async () => {
      const compiler = await new TailwindCSSProcessor().compile(css);
      const output = compiler.build([
        "prose",
        "prose-sm",
        "prose-invert",
        marker,
      ]);
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(output),
          ),
        ),
      )
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
      assertEquals(hash, expected[index]);
    });
  }
});

Deno.test("Typography configuration cannot pollute prototypes or copy inherited properties", async (t) => {
  const marker = "__typographyParserPollutionProbe__";
  function render(css: unknown): unknown {
    const factory = loadPlugin("@tailwindcss/typography");
    assert(typeof factory === "function");
    const plugin: unknown = factory({ target: "legacy" });
    assert(typeof plugin === "object" && plugin !== null);
    const handler = (plugin as { handler: unknown }).handler;
    assert(typeof handler === "function");
    let components: unknown;
    handler({
      theme: () => ({ DEFAULT: { css } }),
      prefix: (selector: string) => selector,
      addVariant: () => {},
      addComponents: (value: unknown) => components = value,
    });
    return components;
  }
  for (
    const payload of [
      `{"__proto__":{"${marker}":true}}`,
      `{"p":{"__proto__":{"${marker}":true}}}`,
      `{"constructor":{"prototype":{"${marker}":true}}}`,
      `{"prototype":{"${marker}":true}}`,
    ]
  ) {
    await t.step(payload, () => {
      assertEquals(
        Object.getOwnPropertyDescriptor(Object.prototype, marker),
        undefined,
      );
      try {
        let error: unknown;
        try {
          render(JSON.parse(payload));
        } catch (caught) {
          error = caught;
        }
        assertEquals(
          Object.getOwnPropertyDescriptor(Object.prototype, marker),
          undefined,
        );
        assert(
          error instanceof TypeError,
          "Unsafe configuration must fail before producing components",
        );
        assert(error.message.includes("unsafe property"));
      } finally {
        delete (Object.prototype as Record<string, unknown>)[marker];
      }
    });
  }
  await t.step("only own configuration properties become CSS", () => {
    assertEquals(render(Object.create({ p: { color: "red" } })), [{
      ".prose": {},
    }]);
    assertEquals(render({ p: { color: "red" } }), [{
      ".prose": { p: { color: "red" } },
    }]);
  });
});
