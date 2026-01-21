import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getEffectiveProjectSlug, isVeryfrontDomain, parseProjectDomain } from "./domain-parser.ts";

describe("domain-parser", () => {
  describe("parseProjectDomain", () => {
    // Local development (veryfront.me - preferred)
    it("veryfront.me preview", () => {
      const result = parseProjectDomain("myproject.preview.veryfront.me:8080");
      assertEquals(result.slug, "myproject");
      assertEquals(result.branch, null);
      assertEquals(result.environment, "preview");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, true);
    });

    it("veryfront.me preview with branch", () => {
      const result = parseProjectDomain("myproject--feature-x.preview.veryfront.me");
      assertEquals(result.slug, "myproject");
      assertEquals(result.branch, "feature-x");
      assertEquals(result.environment, "preview");
    });

    it("veryfront.me base (mirrors production)", () => {
      const result = parseProjectDomain("myproject.veryfront.me:8080");
      assertEquals(result.slug, "myproject");
      assertEquals(result.environment, "production");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, false);
    });

    it("veryfront.me prod (custom domain simulation)", () => {
      const result = parseProjectDomain("example.com.prod.veryfront.me");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "production");
      assertEquals(result.isVeryfrontDomain, false);
    });

    it("plain veryfront.me", () => {
      const result = parseProjectDomain("veryfront.me");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "development");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, true);
    });

    // Local development (lvh.me - alternative)
    it("lvh.me preview", () => {
      const result = parseProjectDomain("myproject.preview.lvh.me:3001");
      assertEquals(result.slug, "myproject");
      assertEquals(result.branch, null);
      assertEquals(result.environment, "preview");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, true);
    });

    it("lvh.me preview with branch", () => {
      const result = parseProjectDomain("myproject--feature-x.preview.lvh.me");
      assertEquals(result.slug, "myproject");
      assertEquals(result.branch, "feature-x");
      assertEquals(result.environment, "preview");
    });

    it("lvh.me base (mirrors production)", () => {
      const result = parseProjectDomain("myproject.lvh.me:3001");
      assertEquals(result.slug, "myproject");
      assertEquals(result.environment, "production");
      assertEquals(result.isDraft, false);
    });

    it("lvh.me prod (custom domain simulation)", () => {
      const result = parseProjectDomain("example.com.prod.lvh.me");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "production");
      assertEquals(result.isVeryfrontDomain, false);
    });

    it("plain lvh.me", () => {
      const result = parseProjectDomain("lvh.me");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "development");
      assertEquals(result.isVeryfrontDomain, true);
    });

    // Production (veryfront.com)
    it("veryfront.com preview", () => {
      const result = parseProjectDomain("myproject.preview.veryfront.com");
      assertEquals(result.slug, "myproject");
      assertEquals(result.environment, "preview");
      assertEquals(result.isDraft, true);
    });

    it("veryfront.org preview with branch", () => {
      const result = parseProjectDomain("myproject--main.preview.veryfront.org");
      assertEquals(result.slug, "myproject");
      assertEquals(result.branch, "main");
    });

    it("veryfront.com staging", () => {
      const result = parseProjectDomain("myproject.staging.veryfront.com");
      assertEquals(result.slug, "myproject");
      assertEquals(result.environment, "staging");
      assertEquals(result.isDraft, false);
    });

    it("veryfront.com production", () => {
      const result = parseProjectDomain("myproject.production.veryfront.com");
      assertEquals(result.slug, "myproject");
      assertEquals(result.environment, "production");
      assertEquals(result.isDraft, false);
    });

    it("veryfront.com base domain", () => {
      const result = parseProjectDomain("myproject.veryfront.com");
      assertEquals(result.slug, "myproject");
      assertEquals(result.environment, "production");
    });

    it("environment root (no slug)", () => {
      const result = parseProjectDomain("preview.veryfront.com");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "preview");
      assertEquals(result.isVeryfrontDomain, true);
    });

    // Custom domains
    it("custom domain (not recognized)", () => {
      const result = parseProjectDomain("example.com");
      assertEquals(result.slug, null);
      assertEquals(result.environment, null);
      assertEquals(result.isVeryfrontDomain, false);
    });

    // Edge cases
    it("handles mixed case domains", () => {
      const result = parseProjectDomain("MyProject.preview.lvh.me");
      assertEquals(result.slug, "MyProject");
      assertEquals(result.environment, "preview");
    });
  });

  describe("isVeryfrontDomain", () => {
    it("recognizes veryfront.com", () => {
      assertEquals(isVeryfrontDomain("myproject.veryfront.com"), true);
      assertEquals(isVeryfrontDomain("myproject.preview.veryfront.com"), true);
    });

    it("recognizes veryfront.me", () => {
      assertEquals(isVeryfrontDomain("myproject.veryfront.me:8080"), true);
      assertEquals(isVeryfrontDomain("veryfront.me"), true);
    });

    it("recognizes lvh.me", () => {
      assertEquals(isVeryfrontDomain("myproject.lvh.me:3001"), true);
      assertEquals(isVeryfrontDomain("lvh.me"), true);
    });

    it("rejects custom domains", () => {
      assertEquals(isVeryfrontDomain("example.com"), false);
    });
  });

  describe("getEffectiveProjectSlug", () => {
    it("prefers slug from host", () => {
      const result = getEffectiveProjectSlug("myproject.preview.lvh.me", "default");
      assertEquals(result.slug, "myproject");
      assertEquals(result.fromHost, true);
    });

    it("falls back to config", () => {
      const result = getEffectiveProjectSlug("example.com", "default");
      assertEquals(result.slug, "default");
      assertEquals(result.fromHost, false);
    });
  });

  describe("branch extraction for preview URLs", () => {
    it("extracts branch from veryfront.com preview URL", () => {
      const result = parseProjectDomain("patient-rosalind-hltxd--foo.preview.veryfront.com");
      assertEquals(result.slug, "patient-rosalind-hltxd");
      assertEquals(result.branch, "foo");
      assertEquals(result.environment, "preview");
      assertEquals(result.isDraft, true);
      assertEquals(result.isVeryfrontDomain, true);
    });

    it("extracts branch from lvh.me preview URL", () => {
      const result = parseProjectDomain("myproject--feature-branch.preview.lvh.me:8080");
      assertEquals(result.slug, "myproject");
      assertEquals(result.branch, "feature-branch");
      assertEquals(result.environment, "preview");
      assertEquals(result.isDraft, true);
    });

    it("returns null branch when no double-dash separator", () => {
      const result = parseProjectDomain("myproject.preview.veryfront.com");
      assertEquals(result.slug, "myproject");
      assertEquals(result.branch, null);
      assertEquals(result.environment, "preview");
    });

    it("handles branch with hyphens", () => {
      const result = parseProjectDomain("project--fix-bug-123.preview.veryfront.com");
      assertEquals(result.slug, "project");
      assertEquals(result.branch, "fix-bug-123");
    });

    it("handles branch from base domain (mirrors production)", () => {
      const result = parseProjectDomain("myproject--experiment.lvh.me:3001");
      assertEquals(result.slug, "myproject");
      assertEquals(result.branch, "experiment");
      assertEquals(result.environment, "production");
      assertEquals(result.isDraft, false);
    });
  });

  describe("allowIframeEmbed", () => {
    it("allows embed for veryfront domains", () => {
      assertEquals(parseProjectDomain("myproject.veryfront.com").allowIframeEmbed, true);
      assertEquals(parseProjectDomain("myproject.preview.veryfront.com").allowIframeEmbed, true);
      assertEquals(parseProjectDomain("myproject.lvh.me").allowIframeEmbed, true);
      assertEquals(parseProjectDomain("myproject.veryfront.me").allowIframeEmbed, true);
    });

    it("allows embed for localhost", () => {
      assertEquals(parseProjectDomain("localhost").allowIframeEmbed, true);
      assertEquals(parseProjectDomain("localhost:3000").allowIframeEmbed, true);
    });

    it("allows embed for xip.io and zip.io", () => {
      assertEquals(parseProjectDomain("192.168.1.1.xip.io").allowIframeEmbed, true);
      assertEquals(parseProjectDomain("myproject.zip.io").allowIframeEmbed, true);
    });

    it("disallows embed for custom domains", () => {
      assertEquals(parseProjectDomain("example.com").allowIframeEmbed, false);
      assertEquals(parseProjectDomain("mysite.org").allowIframeEmbed, false);
    });

    it("disallows embed for prod custom domain simulation", () => {
      assertEquals(parseProjectDomain("example.com.prod.lvh.me").allowIframeEmbed, false);
    });
  });
});
