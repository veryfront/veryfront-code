import "#veryfront/schemas/_test-setup.ts";
import { expect } from "#std/expect.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { shouldIgnorePath } from "./file-watch-setup.ts";

describe("shouldIgnorePath", () => {
  it("ignores paths inside generated/output directories", () => {
    expect(shouldIgnorePath("/proj/node_modules/foo/index.js")).toBe(true);
    expect(shouldIgnorePath("/proj/.git/HEAD")).toBe(true);
    expect(shouldIgnorePath("/proj/.cache/bundle.js")).toBe(true);
    expect(shouldIgnorePath("/proj/.veryfront/manifest.json")).toBe(true);
    expect(shouldIgnorePath("/proj/dist/app.js")).toBe(true);
  });

  it("ignores the Playwright MCP output directory (regression for #1977)", () => {
    expect(
      shouldIgnorePath("/proj/.playwright-mcp/console-2026-06-01T09-33-43.log"),
    ).toBe(true);
    expect(shouldIgnorePath("/proj/.playwright-mcp/page-001.yml")).toBe(true);
    expect(shouldIgnorePath("/proj/.playwright-mcp/screenshot.png")).toBe(true);
  });

  it("ignores generated-artifact extensions anywhere in the tree", () => {
    // Defends against tools that write logs outside a known output directory.
    expect(shouldIgnorePath("/proj/server.log")).toBe(true);
    expect(shouldIgnorePath("/proj/pages/build.LOG")).toBe(true);
    expect(shouldIgnorePath("/proj/scratch.tmp")).toBe(true);
  });

  it("does not ignore legitimate source files", () => {
    expect(shouldIgnorePath("/proj/pages/index.tsx")).toBe(false);
    expect(shouldIgnorePath("/proj/components/Button.jsx")).toBe(false);
    expect(shouldIgnorePath("/proj/lib/util.ts")).toBe(false);
    expect(shouldIgnorePath("/proj/styles/app.css")).toBe(false);
    expect(shouldIgnorePath("/proj/content/post.mdx")).toBe(false);
    expect(shouldIgnorePath("/proj/README.md")).toBe(false);
    expect(shouldIgnorePath("/proj/resources/data.json")).toBe(false);
  });
});
