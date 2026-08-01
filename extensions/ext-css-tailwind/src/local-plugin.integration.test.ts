/** Integration check for every extension-owned local Tailwind plugin. */

import { TailwindCSSProcessor } from "./index.ts";
import { TAILWIND_PLUGIN_POLICY } from "./plugin-policy.ts";

export async function runTests(): Promise<void> {
  const stylesheet = [
    '@import "tailwindcss";',
    ...TAILWIND_PLUGIN_POLICY.map(({ name }) => `@plugin "${name}";`),
  ].join("\n");
  const compiler = await new TailwindCSSProcessor().compile(stylesheet);
  const css = compiler.build([
    "animate-in",
    "btn",
    "prose",
    "scrollbar-hide",
  ]);
  for (const marker of ["animate-in", "btn", "prose", "scrollbar-hide"]) {
    if (!css.includes(marker)) {
      throw new TypeError(`Local Tailwind plugins did not emit ${marker}`);
    }
  }
}

if (import.meta.main) {
  await runTests();
} else {
  Deno.test("all audited local Tailwind plugins compile without network or write access", runTests);
}
