import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { escapeHtml } from "./html-escape.ts";

describe("html-escape", () => {
  it("escapes every HTML text and attribute delimiter", () => {
    assertEquals(
      escapeHtml(`<a title="'">&`),
      "&lt;a title=&quot;&#39;&quot;&gt;&amp;",
    );
  });

  it("does not double-process entities produced during the same pass", () => {
    assertEquals(escapeHtml("<&"), "&lt;&amp;");
  });
});
