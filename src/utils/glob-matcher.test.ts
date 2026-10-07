import { assertEquals } from "#veryfront/testing/assert.ts";
import { globMatches } from "./glob-matcher.ts";

Deno.test("shared glob matcher keeps stars within path segments", () => {
  assertEquals(globMatches("knowledge/*.md", "knowledge/login.md"), true);
  assertEquals(globMatches("knowledge/*.md", "knowledge/support/login.md"), false);
});

Deno.test("shared glob matcher supports single-character wildcards", () => {
  assertEquals(globMatches("skills/tool-?.md", "skills/tool-a.md"), true);
  assertEquals(globMatches("skills/tool-?.md", "skills/tool-ab.md"), false);
  assertEquals(globMatches("skills/tool-?.md", "skills/tool-/a.md"), false);
});

Deno.test("shared glob matcher supports globstar across zero or more directories", () => {
  assertEquals(globMatches("knowledge/**/login.md", "knowledge/login.md"), true);
  assertEquals(globMatches("knowledge/**/login.md", "knowledge/support/login.md"), true);
  assertEquals(
    globMatches("knowledge/**/login.md", "knowledge/support/auth/login.md"),
    true,
  );
  assertEquals(globMatches("knowledge/**/login.md", "knowledge/support-login.md"), false);
});

Deno.test("shared glob matcher escapes regex syntax in literal pattern text", () => {
  assertEquals(globMatches("knowledge/v1.0/[draft].md", "knowledge/v1.0/[draft].md"), true);
  assertEquals(globMatches("knowledge/v1.0/[draft].md", "knowledge/v1x0/d.md"), false);
});

Deno.test("shared glob matcher handles repeated wildcard fragments without regex backtracking", () => {
  const pattern = `knowledge/${"*a".repeat(200)}.md`;
  const value = `knowledge/${"a".repeat(200)}.txt`;

  assertEquals(globMatches(pattern, value), false);
});
