import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeMDXFrontmatter } from "./frontmatter.ts";

describe("build/compiler/frontmatter", () => {
  it("rejects accessor-backed metadata without invoking it", () => {
    let accessed = false;
    const value = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(value, "title", {
      enumerable: true,
      get() {
        accessed = true;
        return "unsafe";
      },
    });

    assertThrows(
      () => normalizeMDXFrontmatter(value),
      TypeError,
      "data properties",
    );
    assertEquals(accessed, false);
  });

  it("bounds nested metadata work", () => {
    let value: Record<string, unknown> = {};
    const root = value;
    for (let index = 0; index < 40; index++) {
      const child: Record<string, unknown> = {};
      value.child = child;
      value = child;
    }

    assertThrows(
      () => normalizeMDXFrontmatter(root),
      TypeError,
      "depth limit",
    );
  });

  it("returns a detached JSON snapshot and normalizes dates", () => {
    const source = {
      title: "Release",
      nested: { publishedAt: new Date("2026-01-02T03:04:05.000Z") },
    };
    const result = normalizeMDXFrontmatter(source);

    assertEquals(result, {
      title: "Release",
      nested: { publishedAt: "2026-01-02T03:04:05.000Z" },
    });
    source.nested.publishedAt = new Date("2027-01-02T03:04:05.000Z");
    assertEquals(
      (result.nested as { publishedAt: string }).publishedAt,
      "2026-01-02T03:04:05.000Z",
    );
  });
});
