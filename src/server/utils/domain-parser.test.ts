import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getEffectiveProjectSlug,
  HOSTED_ENVIRONMENT_NAMES,
  isHostedEnvironmentName,
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

    it("public loopback-resolving wildcard DNS roots are not local dev domains", () => {
      // `localhost` is the only local dev root. Public names that happen to
      // resolve to 127.0.0.1 are ordinary registrable domains and must fall
      // through to the custom-domain path.
      for (
        const host of [
          "wildcard-dns.example",
          "myproject.wildcard-dns.example",
          "myproject.preview.wildcard-dns.example",
        ]
      ) {
        const result = parseProjectDomain(host);
        assertEquals(result.slug, null, host);
        assertEquals(result.environment, null, host);
        assertEquals(result.isVeryfrontDomain, false, host);
      }
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
      const result = parseProjectDomain("MyProject.preview.localhost");
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

    it("rejects custom domains", () => {
      assertEquals(isVeryfrontDomain("example.com"), false);
    });

    it("rejects public loopback-resolving wildcard DNS roots", () => {
      assertEquals(isVeryfrontDomain("wildcard-dns.example"), false);
      assertEquals(isVeryfrontDomain("myproject.wildcard-dns.example:3001"), false);
    });
  });

  describe("getEffectiveProjectSlug", () => {
    it("prefers slug from host", () => {
      const result = getEffectiveProjectSlug("myproject.preview.localhost", "default");
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

    it("extracts branch from localhost preview URL", () => {
      const result = parseProjectDomain("myproject--feature-branch.preview.localhost:8080");
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
      const result = parseProjectDomain("myproject--experiment.localhost:3001");
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

    it("recognizes the bare local dev root", () => {
      assertEquals(isLocalDevHost("localhost"), true);
      assertEquals(isLocalDevHost("localhost:8080"), true);
    });

    it("recognizes slug-only local dev domains", () => {
      assertEquals(isLocalDevHost("myproject.localhost"), true);
      assertEquals(isLocalDevHost("myproject.localhost:3001"), true);
    });

    it("recognizes preview local dev domains", () => {
      assertEquals(isLocalDevHost("myproject.preview.localhost"), true);
      assertEquals(isLocalDevHost("myproject.preview.localhost:3001"), true);
      assertEquals(isLocalDevHost("preview.localhost"), true);
    });

    it("rejects explicit production local dev domains", () => {
      assertEquals(isLocalDevHost("myproject.production.localhost"), false);
    });

    it("rejects explicit staging local dev domains", () => {
      assertEquals(isLocalDevHost("myproject.staging.localhost"), false);
    });

    it("rejects custom domain simulation", () => {
      assertEquals(isLocalDevHost("example.com.prod.localhost"), false);
    });

    // `localhost` is a single label with no registrable domain, so `*.localhost`
    // cannot be admitted by a blanket suffix test the way a two-label root could.
    // It goes through the same parse, which keeps the non-dev namespaces out.
    it("classifies *.localhost by parse, not by a blanket suffix allow", () => {
      assertEquals(isLocalDevHost("myproject.production.localhost:3000"), false);
      assertEquals(isLocalDevHost("myproject.staging.localhost:3000"), false);
      assertEquals(isLocalDevHost("staging.localhost"), false);
      assertEquals(isLocalDevHost("myproject.foobar.localhost"), false);
      assertEquals(isLocalDevHost("example.com.prod.localhost"), false);
      assertEquals(isLocalDevHost("a.b.c.localhost"), false);
      assertEquals(isLocalDevHost("myproject.localhost"), true);
      assertEquals(isLocalDevHost("myproject.preview.localhost"), true);
    });

    it("rejects hosts that merely contain or prefix the local root", () => {
      // A suffix test must anchor: `notlocalhost` and `localhost.attacker.example`
      // both end with or start with the root's characters without being under it.
      assertEquals(isLocalDevHost("notlocalhost"), false);
      assertEquals(isLocalDevHost("localhost.attacker.example"), false);
      assertEquals(isLocalDevHost("myproject.localhost.attacker.example"), false);
    });

    it("rejects public loopback-resolving wildcard DNS roots", () => {
      assertEquals(isLocalDevHost("wildcard-dns.example"), false);
      assertEquals(isLocalDevHost("myproject.wildcard-dns.example:3001"), false);
      assertEquals(isLocalDevHost("myproject.preview.wildcard-dns.example"), false);
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
      assertEquals(parseProjectDomain("example.com.prod.localhost").allowIframeEmbed, false);
    });
  });

  describe("HOSTED_ENVIRONMENT_NAMES", () => {
    it("names exactly the labels parseProjectDomain routes to a hosted project", () => {
      for (const name of HOSTED_ENVIRONMENT_NAMES) {
        const parsed = parseProjectDomain(`myproject.${name}.veryfront.com`);
        assertEquals(parsed.slug, "myproject", `${name} must resolve a project slug`);
        assertEquals(parsed.environment, name);
        assertEquals(parsed.isVeryfrontDomain, true);
      }
    });

    it("excludes labels the hosted platform cannot route", () => {
      // `development` is the one that matters: it is a valid local environment
      // and reads like a natural deploy target, but no hosted rule produces it.
      for (const name of ["development", "dev", "qa", "test", "sandbox"]) {
        assertEquals(isHostedEnvironmentName(name), false, `${name} must not be hosted-routable`);
        const parsed = parseProjectDomain(`myproject.${name}.veryfront.com`);
        assertEquals(parsed.slug, null, `${name} must not resolve a project slug`);
        assertEquals(parsed.environment, null);
        assertEquals(parsed.isVeryfrontDomain, false);
      }
    });

    it("matches environment names case-insensitively", () => {
      assertEquals(isHostedEnvironmentName("Production"), true);
      assertEquals(isHostedEnvironmentName("STAGING"), true);
      assertEquals(isHostedEnvironmentName("Development"), false);
    });

    it("answers about the label, not about the caller's string", () => {
      // The check folds case, so a true answer says nothing about the spelling
      // the caller holds. It must therefore stay a plain boolean: as a
      // `name is HostedEnvironmentName` predicate it typed `"Production"` as a
      // lowercase-only literal, and an exhaustive switch or keyed lookup built
      // on that narrowing misses at runtime — exactly as this assertion shows.
      const name = "Production";
      const routable: boolean = isHostedEnvironmentName(name);
      assertEquals(routable, true);
      assertEquals(
        (HOSTED_ENVIRONMENT_NAMES as readonly string[]).includes(name),
        false,
        "the caller's spelling is not one of the hosted labels",
      );
    });
  });
});
