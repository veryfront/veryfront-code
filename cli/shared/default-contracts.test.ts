import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { register, reset, tryResolve } from "veryfront/extensions/contracts";
import type { SkillDocumentParserProvider } from "veryfront/extensions/parser";
import { ensureCliSkillDocumentParser } from "./default-contracts.ts";

Deno.test("CLI composes the first-party Skill YAML parser once", async () => {
  reset();
  await ensureCliSkillDocumentParser();
  const first = tryResolve<SkillDocumentParserProvider>(
    "SkillDocumentParserProvider",
  );
  await ensureCliSkillDocumentParser();

  assertEquals(
    tryResolve("SkillDocumentParserProvider"),
    first,
  );
  assertEquals(first?.parseFrontmatter("name: demo"), { name: "demo" });
  reset();
});

Deno.test("CLI rejects an invalid registered Skill parser instead of treating it as ready", async () => {
  reset();
  register("SkillDocumentParserProvider", { parseFrontmatter: "invalid" });
  try {
    await assertRejects(
      () => ensureCliSkillDocumentParser(),
      TypeError,
      "provider must be a plain object",
    );
  } finally {
    reset();
  }
});
