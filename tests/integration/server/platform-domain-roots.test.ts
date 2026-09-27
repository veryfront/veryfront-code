import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseConfiguredPlatformRoots } from "#veryfront/server/utils/domain-parser.ts";

let configuredParserIndex = 0;
async function parserWithRoots(raw: string | undefined) {
  const old = Deno.env.get("PLATFORM_DOMAIN_SUFFIXES");
  try {
    if (raw === undefined) Deno.env.delete("PLATFORM_DOMAIN_SUFFIXES");
    else Deno.env.set("PLATFORM_DOMAIN_SUFFIXES", raw);
    return await import(
      `../../../src/server/utils/domain-parser.ts?operator-roots-${++configuredParserIndex}`
    );
  } finally {
    if (old === undefined) Deno.env.delete("PLATFORM_DOMAIN_SUFFIXES");
    else Deno.env.set("PLATFORM_DOMAIN_SUFFIXES", old);
  }
}

describe("domain-parser operator configuration", () => {
  describe("admin-configured platform roots", () => {
    const root = "verified-0924.127.0.0.1.sslip.io";

    it("reads the operator host setting in the actual default parser", async () => {
      const configured = await parserWithRoots(root);
      const parsed = configured.parseProjectDomain(`app.preview.${root}`);
      assertEquals(parsed.slug, "app");
      assertEquals(parsed.environment, "preview");
      assertEquals(parsed.isVeryfrontDomain, true);
    });

    it("recognizes exact preview, staging and production hosts", async () => {
      const roots = parseConfiguredPlatformRoots(
        `  ${root.toUpperCase()} , customer.example.test `,
      );
      assertEquals(roots, [root, "customer.example.test"]);
      const configured = await parserWithRoots(`  ${root.toUpperCase()} , customer.example.test `);
      assertEquals(configured.parseProjectDomain(`app--feature.preview.${root}:58443`), {
        slug: "app",
        branch: "feature",
        environment: "preview",
        isVeryfrontDomain: true,
        isDraft: true,
        allowIframeEmbed: true,
      });
      assertEquals(configured.parseProjectDomain(`app.staging.${root}`).environment, "staging");
      assertEquals(
        configured.parseProjectDomain(`app.production.${root}`).environment,
        "production",
      );
      assertEquals(configured.isVeryfrontDomain(`app.preview.${root}`), true);
    });

    it("does not claim unconfigured public wildcard DNS or adjacent labels", async () => {
      const unconfigured = await parserWithRoots(undefined);
      for (
        const host of [
          `app.preview.${root}`,
          "app.preview.127.0.0.1.sslip.io",
        ]
      ) {
        assertEquals(unconfigured.parseProjectDomain(host).isVeryfrontDomain, false);
        assertEquals(unconfigured.isVeryfrontDomain(host), false);
      }
      const configured = await parserWithRoots(root);
      for (
        const host of [
          `app.${root}`,
          `preview.${root}`,
          `app.development.${root}`,
          `app.preview.evil${root}`,
          `app.preview.${root}.evil.example`,
          `other.app.preview.${root}`,
        ]
      ) {
        assertEquals(configured.parseProjectDomain(host).isVeryfrontDomain, false, host);
      }
    });

    it("uses the longest configured suffix at a label boundary", async () => {
      const roots = parseConfiguredPlatformRoots("example.test,customer.example.test");
      assertEquals(roots, ["customer.example.test", "example.test"]);
      const configured = await parserWithRoots("example.test,customer.example.test");
      assertEquals(configured.parseProjectDomain("app.preview.customer.example.test").slug, "app");
      assertEquals(
        configured.parseProjectDomain("app.production.example.test").environment,
        "production",
      );
      assertEquals(
        configured.parseProjectDomain("app.preview.notcustomer.example.test").isVeryfrontDomain,
        false,
      );
    });

    it("refuses malformed or wildcard admin roots", () => {
      for (
        const value of [
          "*.sslip.io",
          ".example.test",
          "example.test.",
          "http://example.test",
          "localhost",
          "127.0.0.1",
          "foo..bar",
          "-foo.example",
          "foo.example:443",
          "example.test,,other.test",
        ]
      ) {
        let refused = false;
        try {
          parseConfiguredPlatformRoots(value);
        } catch {
          refused = true;
        }
        assertEquals(refused, true, value);
      }
    });
  });
});
