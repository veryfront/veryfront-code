import { assertEquals } from "#std/assert";
import { markdownProse } from "./markdown-prose.ts";

Deno.test("repository link checks ignore fenced examples while retaining real links", () => {
  for (const marker of ["```", "~~~~"]) {
    const source = [
      "[Before](./before.md)",
      `${marker}tsx`,
      "// image (`[![alt](src)](href)`) is an example, not a source link",
      "[Example](./not-a-real-file.md)",
      marker[0].repeat(marker.length - 1),
      "[Still inside](./also-not-a-file.md)",
      marker,
      "[After](./after.md)",
    ].join("\n");
    assertEquals(markdownProse(source).split("\n").filter(Boolean), [
      "[Before](./before.md)",
      "[After](./after.md)",
    ]);
  }
});

Deno.test("repository link checks preserve CRLF prose around long fenced examples", () => {
  const fence = "`".repeat(4096);
  const source = [
    "[Before](./before.md)",
    fence + "md",
    "[Example](./missing.md)",
    fence,
    "[After](./after.md)",
  ].join("\r\n");
  assertEquals(
    markdownProse(source).split("\n").filter(Boolean).map((line) =>
      line.trim()
    ),
    ["[Before](./before.md)", "[After](./after.md)"],
  );
});
