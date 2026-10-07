import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import {
  TAILWIND_DEFAULT_STYLESHEET,
  TailwindCSSProcessor,
} from "../../../../extensions/ext-css-tailwind/src/index.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FRAMEWORK_CANDIDATES } from "./framework-candidates.generated.ts";

describe("server/handlers/dev/framework-candidates.generated", () => {
  it("includes chat framework candidates required for preview styling", () => {
    const candidates = new Set(FRAMEWORK_CANDIDATES);

    assertEquals(candidates.has("size-4"), true);
    assertEquals(candidates.has("size-8"), true);
    assertEquals(candidates.has("bg-[#181818]"), true);
  });

  it("includes adapter-backed UI state and surface candidates", () => {
    const candidates = new Set(FRAMEWORK_CANDIDATES);

    assertEquals(candidates.has("data-[state=on]:bg-[var(--secondary)]"), true);
    assertEquals(candidates.has("pointer-events-none"), true);
    assertEquals(candidates.has("divide-[var(--separator)]"), true);
    assertEquals(candidates.has("w-[calc(100%_-_3rem)]"), true);
    assertEquals(candidates.has("w-[calc(100%-3rem)]"), false);
  });

  it("emits semantic input placeholder utilities through the real CSS processor", async () => {
    const candidates = new Set(FRAMEWORK_CANDIDATES);

    assertEquals(candidates.has("placeholder:text-[var(--input-placeholder)]"), true);
    assertEquals(candidates.has("text-[var(--input-placeholder)]"), true);

    const compiler = await new TailwindCSSProcessor().compile(TAILWIND_DEFAULT_STYLESHEET);
    const css = compiler.build([
      "placeholder:text-[var(--input-placeholder)]",
      "text-[var(--input-placeholder)]",
    ]);

    assertStringIncludes(css, ".placeholder\\:text-\\[var\\(--input-placeholder\\)\\]");
    assertStringIncludes(css, "&::placeholder");
    assertStringIncludes(css, "color: var(--input-placeholder)");
    assertStringIncludes(css, ".text-\\[var\\(--input-placeholder\\)\\]");
  });
});
