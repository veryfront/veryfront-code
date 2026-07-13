import { assertEquals } from "#std/assert";
import { DEFAULT_INCLUDES } from "./compile-binary.ts";

Deno.test("compiled CLI embeds optional builtin extension source files", async () => {
  const source = await Deno.readTextFile("src/extensions/builtin-extensions.ts");
  const sourceDirectories = Array.from(
    source.matchAll(/sourceDirectory:\s*"([^"]+)"/g),
    (match) => match[1]!,
  );

  for (const sourceDirectory of sourceDirectories) {
    assertEquals(
      DEFAULT_INCLUDES.includes(`extensions/${sourceDirectory}/src/index.ts`),
      true,
      `compile-binary DEFAULT_INCLUDES must embed optional builtin ${sourceDirectory}`,
    );
  }
});
