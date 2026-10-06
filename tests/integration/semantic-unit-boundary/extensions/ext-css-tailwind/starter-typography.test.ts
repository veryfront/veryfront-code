import { assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { TailwindCSSProcessor } from "../../../../../extensions/ext-css-tailwind/src/index.ts";
import { loadTemplateFromDirectory } from "../../../../../templates/loader.ts";

describe("minimal starter typography integration", () => {
  it("compiles About page typography classes from source and embedded template CSS", async () => {
    const stylesheet = await Deno.readTextFile(
      new URL("../../../../../templates/files/minimal/globals.css", import.meta.url),
    );
    const compiler = await new TailwindCSSProcessor().compile(stylesheet);
    const css = compiler.build(["prose", "dark:prose-invert"]);
    assertStringIncludes(css, ".prose");
    assertStringIncludes(css, "--tw-prose-invert-body");

    const files = await loadTemplateFromDirectory("minimal");
    const embeddedStylesheet = files.find((file) => file.path === "globals.css");
    assertExists(embeddedStylesheet);
    const embeddedCompiler = await new TailwindCSSProcessor().compile(embeddedStylesheet.content);
    assertStringIncludes(embeddedCompiler.build(["prose", "dark:prose-invert"]), ".prose");
  });
});
