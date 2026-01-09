import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { getEffectiveProjectSlug, isVeryfrontDomain, parseProjectDomain } from "./domain-parser.ts";

Deno.test("parseProjectDomain", async (t) => {
  // Local development (lvh.me)
  await t.step("lvh.me preview", () => {
    const result = parseProjectDomain("myproject.preview.lvh.me:3001");
    assertEquals(result.slug, "myproject");
    assertEquals(result.branch, null);
    assertEquals(result.environment, "preview");
    assertEquals(result.isVeryfrontDomain, true);
    assertEquals(result.isDraft, true);
  });

  await t.step("lvh.me preview with branch", () => {
    const result = parseProjectDomain("myproject--feature-x.preview.lvh.me");
    assertEquals(result.slug, "myproject");
    assertEquals(result.branch, "feature-x");
    assertEquals(result.environment, "preview");
  });

  await t.step("lvh.me development", () => {
    const result = parseProjectDomain("myproject.lvh.me:3001");
    assertEquals(result.slug, "myproject");
    assertEquals(result.environment, "development");
    assertEquals(result.isDraft, true);
  });

  await t.step("lvh.me prod (custom domain simulation)", () => {
    const result = parseProjectDomain("example.com.prod.lvh.me");
    assertEquals(result.slug, null);
    assertEquals(result.environment, "production");
    assertEquals(result.isVeryfrontDomain, false);
  });

  await t.step("plain lvh.me", () => {
    const result = parseProjectDomain("lvh.me");
    assertEquals(result.slug, null);
    assertEquals(result.environment, "development");
    assertEquals(result.isVeryfrontDomain, true);
  });

  // Production (veryfront.com)
  await t.step("veryfront.com preview", () => {
    const result = parseProjectDomain("myproject.preview.veryfront.com");
    assertEquals(result.slug, "myproject");
    assertEquals(result.environment, "preview");
    assertEquals(result.isDraft, true);
  });

  await t.step("veryfront.org preview with branch", () => {
    const result = parseProjectDomain("myproject--main.preview.veryfront.org");
    assertEquals(result.slug, "myproject");
    assertEquals(result.branch, "main");
  });

  await t.step("veryfront.com staging", () => {
    const result = parseProjectDomain("myproject.staging.veryfront.com");
    assertEquals(result.slug, "myproject");
    assertEquals(result.environment, "staging");
    assertEquals(result.isDraft, false);
  });

  await t.step("veryfront.com production", () => {
    const result = parseProjectDomain("myproject.production.veryfront.com");
    assertEquals(result.slug, "myproject");
    assertEquals(result.environment, "production");
    assertEquals(result.isDraft, false);
  });

  await t.step("veryfront.com base domain", () => {
    const result = parseProjectDomain("myproject.veryfront.com");
    assertEquals(result.slug, "myproject");
    assertEquals(result.environment, "production");
  });

  await t.step("environment root (no slug)", () => {
    const result = parseProjectDomain("preview.veryfront.com");
    assertEquals(result.slug, null);
    assertEquals(result.environment, "preview");
    assertEquals(result.isVeryfrontDomain, true);
  });

  // Custom domains
  await t.step("custom domain (not recognized)", () => {
    const result = parseProjectDomain("example.com");
    assertEquals(result.slug, null);
    assertEquals(result.environment, null);
    assertEquals(result.isVeryfrontDomain, false);
  });

  // Edge cases
  await t.step("handles mixed case domains", () => {
    const result = parseProjectDomain("MyProject.preview.lvh.me");
    assertEquals(result.slug, "MyProject");
    assertEquals(result.environment, "preview");
  });
});

Deno.test("isVeryfrontDomain", async (t) => {
  await t.step("recognizes veryfront.com", () => {
    assertEquals(isVeryfrontDomain("myproject.veryfront.com"), true);
    assertEquals(isVeryfrontDomain("myproject.preview.veryfront.com"), true);
  });

  await t.step("recognizes lvh.me", () => {
    assertEquals(isVeryfrontDomain("myproject.lvh.me:3001"), true);
    assertEquals(isVeryfrontDomain("lvh.me"), true);
  });

  await t.step("rejects custom domains", () => {
    assertEquals(isVeryfrontDomain("example.com"), false);
  });
});

Deno.test("getEffectiveProjectSlug", async (t) => {
  await t.step("prefers slug from host", () => {
    const result = getEffectiveProjectSlug("myproject.preview.lvh.me", "default");
    assertEquals(result.slug, "myproject");
    assertEquals(result.fromHost, true);
  });

  await t.step("falls back to config", () => {
    const result = getEffectiveProjectSlug("example.com", "default");
    assertEquals(result.slug, "default");
    assertEquals(result.fromHost, false);
  });
});
