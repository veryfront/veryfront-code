import { assertExists, assertStringIncludes } from "@std/assert";
import { loadTemplateFromDirectory } from "../../../templates/loader.ts";
import { TailwindCSSProcessor } from "./index.ts";

Deno.test("minimal starter compiles About page typography", async () => {
  const stylesheet = await Deno.readTextFile(
    new URL("../../../templates/files/minimal/globals.css", import.meta.url),
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
