import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getEffectiveProjectSlug,
  isLocalDevHost,
  isVeryfrontDomain,
  parseProjectDomain,
} from "./domain-parser.ts";

describe("domain-parser", () => {
  describe("parseProjectDomain", () => {
    it("localhost preview", () => {
      const result = parseProjectDomain("myproject.preview.localhost:8080");
      assertEquals(result.slug, "myproject");
      assertEquals(result.branch, null);
      assertEquals(result.environment, "preview");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, true);
    });

    it("localhost preview with branch", () => {
      const result = parseProjectDomain("myproject--feature-x.preview.localhost");
      assertEquals(result.slug, "myproject");
      assertEquals(result.branch, "feature-x");
      assertEquals(result.environment, "preview");
    });

    it("localhost base (mirrors production)", () => {
      const result = parseProjectDomain("myproject.localhost:8080");
      assertEquals(result.slug, "myproject");
      assertEquals(result.environment, "production");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, false);
    });

    it("localhost prod (custom domain simulation)", () => {
      const result = parseProjectDomain("example.com.prod.localhost");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "production");
      assertEquals(result.isVeryfrontDomain, false);
    });

    it("plain localhost", () => {
      const result = parseProjectDomain("localhost");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "development");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, true);
    });

    it("local preview environment root (localhost)", () => {
      const result = parseProjectDomain("preview.localhost");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "preview");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, true);
    });

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

    it("local preview environment root (lvh.me)", () => {
      const result = parseProjectDomain("preview.lvh.me");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "preview");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, true);
    });

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

    it("veryfront.com bare subdomain is not recognized (no longer supported)", () => {
      const result = parseProjectDomain("myproject.veryfront.com");
      assertEquals(result.slug, null);
      assertEquals(result.environment, null);
      assertEquals(result.isVeryfrontDomain, false);
    });

    it("local dev explicit production: {slug}.production.lvh.me", () => {
      const result = parseProjectDomain("myproject.production.lvh.me:3001");
      assertEquals(result.slug, "myproject");
      assertEquals(result.environment, "production");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, false);
    });

    it("local dev explicit production: {slug}.production.localhost", () => {
      const result = parseProjectDomain("myproject.production.localhost:8080");
      assertEquals(result.slug, "myproject");
      assertEquals(result.environment, "production");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, false);
    });

    it("local dev explicit staging: {slug}.staging.localhost", () => {
      const result = parseProjectDomain("myproject.staging.localhost:8080");
      assertEquals(result.slug, "myproject");
      assertEquals(result.environment, "staging");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, false);
    });

    it("environment root (no slug)", () => {
      const result = parseProjectDomain("preview.veryfront.com");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "preview");
      assertEquals(result.isVeryfrontDomain, true);
    });

    it("local staging environment root (lvh.me)", () => {
      const result = parseProjectDomain("staging.lvh.me");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "staging");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, false);
    });

    it("local production environment root (lvh.me)", () => {
      const result = parseProjectDomain("production.lvh.me");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "production");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, false);
    });

    it("local staging environment root (localhost)", () => {
      const result = parseProjectDomain("staging.localhost");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "staging");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, false);
    });

    it("local production environment root (localhost)", () => {
      const result = parseProjectDomain("production.localhost");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "production");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, false);
    });

    it("production environment root (veryfront.com)", () => {
      const result = parseProjectDomain("production.veryfront.com");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "production");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, false);
    });

    it("staging environment root (veryfront.com)", () => {
      const result = parseProjectDomain("staging.veryfront.com");
      assertEquals(result.slug, null);
      assertEquals(result.environment, "staging");
      assertEquals(result.isVeryfrontDomain, true);
      assertEquals(result.isDraft, false);
    });

    it("local unknown namespace is not recognized", () => {
      const result = parseProjectDomain("myproject.foobar.localhost");
      assertEquals(result.slug, null);
      assertEquals(result.environment, null);
      assertEquals(result.isVeryfrontDomain, false);
    });

    it("custom domain (not recognized)", () => {
      const result = parseProjectDomain("example.com");
      assertEquals(result.slug, null);
      assertEquals(result.environment, null);
      assertEquals(result.isVeryfrontDomain, false);
    });

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

    it("recognizes localhost", () => {
      assertEquals(isVeryfrontDomain("myproject.localhost:8080"), true);
      assertEquals(isVeryfrontDomain("localhost"), true);
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

  describe("isLocalDevHost", () => {
    it("recognizes loopback addresses", () => {
      assertEquals(isLocalDevHost("localhost"), true);
      assertEquals(isLocalDevHost("localhost:3000"), true);
      assertEquals(isLocalDevHost("127.0.0.1"), true);
      assertEquals(isLocalDevHost("127.0.0.1:8080"), true);
      assertEquals(isLocalDevHost("0.0.0.0"), true);
      assertEquals(isLocalDevHost("0.0.0.0:3000"), true);
    });

    it("recognizes *.localhost (W3C secure context)", () => {
      assertEquals(isLocalDevHost("myproject.localhost"), true);
      assertEquals(isLocalDevHost("myproject.localhost:3000"), true);
    });

    it("recognizes bare local dev domains", () => {
      assertEquals(isLocalDevHost("localhost"), true);
      assertEquals(isLocalDevHost("lvh.me"), true);
      assertEquals(isLocalDevHost("veryfront.dev"), true);
      assertEquals(isLocalDevHost("localhost:8080"), true);
    });

    it("recognizes slug-only local dev domains", () => {
      assertEquals(isLocalDevHost("myproject.localhost"), true);
      assertEquals(isLocalDevHost("myproject.lvh.me:3001"), true);
      assertEquals(isLocalDevHost("myproject.veryfront.dev"), true);
    });

    it("recognizes preview local dev domains", () => {
      assertEquals(isLocalDevHost("myproject.preview.localhost"), true);
      assertEquals(isLocalDevHost("myproject.preview.lvh.me:3001"), true);
      assertEquals(isLocalDevHost("preview.localhost"), true);
      assertEquals(isLocalDevHost("preview.lvh.me"), true);
    });

    it("rejects explicit production local dev domains", () => {
      assertEquals(isLocalDevHost("myproject.production.localhost"), false);
      assertEquals(isLocalDevHost("myproject.production.lvh.me"), false);
    });

    it("rejects explicit staging local dev domains", () => {
      assertEquals(isLocalDevHost("myproject.staging.localhost"), false);
      assertEquals(isLocalDevHost("myproject.staging.lvh.me"), false);
    });

    it("rejects custom domain simulation", () => {
      assertEquals(isLocalDevHost("example.com.prod.lvh.me"), false);
      assertEquals(isLocalDevHost("example.com.prod.localhost"), false);
    });

    // `localhost` is a single label with no registrable domain, so `*.localhost`
    // cannot be admitted by a blanket suffix test the way a two-label root can.
    // It goes through the same parse, which keeps the non-dev namespaces out.
    it("classifies *.localhost by the same rules as the two-label local roots", () => {
      for (const root of ["localhost", "lvh.me"]) {
        assertEquals(isLocalDevHost(`myproject.production.${root}:3000`), false, root);
        assertEquals(isLocalDevHost(`myproject.staging.${root}:3000`), false, root);
        assertEquals(isLocalDevHost(`staging.${root}`), false, root);
        assertEquals(isLocalDevHost(`myproject.foobar.${root}`), false, root);
        assertEquals(isLocalDevHost(`example.com.prod.${root}`), false, root);
        assertEquals(isLocalDevHost(`a.b.c.${root}`), false, root);
        assertEquals(isLocalDevHost(`myproject.${root}`), true, root);
        assertEquals(isLocalDevHost(`myproject.preview.${root}`), true, root);
      }
    });

    it("rejects custom domains", () => {
      assertEquals(isLocalDevHost("example.com"), false);
      assertEquals(isLocalDevHost("mysite.org"), false);
    });

    it("rejects production veryfront domains", () => {
      assertEquals(isLocalDevHost("myproject.preview.veryfront.com"), false);
      assertEquals(isLocalDevHost("myproject.veryfront.com"), false);
    });

    it("rejects unknown namespace on local dev domains", () => {
      assertEquals(isLocalDevHost("myproject.foobar.localhost"), false);
    });
  });

  describe("allowIframeEmbed", () => {
    it("allows embed for veryfront domains", () => {
      assertEquals(parseProjectDomain("myproject.production.veryfront.com").allowIframeEmbed, true);
      assertEquals(parseProjectDomain("myproject.preview.veryfront.com").allowIframeEmbed, true);
      assertEquals(parseProjectDomain("myproject.lvh.me").allowIframeEmbed, true);
      assertEquals(parseProjectDomain("myproject.localhost").allowIframeEmbed, true);
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
