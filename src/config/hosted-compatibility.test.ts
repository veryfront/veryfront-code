import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findHostedConfigIncompatibility,
  formatHostedConfigIncompatibility,
} from "./hosted-compatibility.ts";

const EXTENSION_CONFIG = `import { defineConfig } from "veryfront";
import extCssLightning from "@veryfront/ext-css-lightning";

export default defineConfig({
  extensions: [extCssLightning()],
});
`;

describe("hosted config compatibility", () => {
  it("names the extension import that makes a project undeployable", async () => {
    const incompatibility = await findHostedConfigIncompatibility(EXTENSION_CONFIG);

    assertEquals(incompatibility?.reason, "unsupported-import");
    assertEquals(incompatibility?.line, 2);
    assertEquals(
      incompatibility?.excerpt,
      `import extCssLightning from "@veryfront/ext-css-lightning";`,
    );
  });

  it("names an extension import that stands on its own", async () => {
    const incompatibility = await findHostedConfigIncompatibility(
      `import extCssLightning from "@veryfront/ext-css-lightning";\n` +
        `export default { extensions: [extCssLightning()] };\n`,
    );

    assertEquals(incompatibility?.code, "unsupported-syntax");
    assertEquals(incompatibility?.reason, "unsupported-import");
    assertEquals(incompatibility?.line, 1);
  });

  it("formats a message that says where, what, and what to do", () => {
    const message = formatHostedConfigIncompatibility({
      code: "unsupported-syntax",
      reason: "unsupported-import",
      line: 2,
      excerpt: `import extCssLightning from "@veryfront/ext-css-lightning";`,
      summary: "Summary sentence.",
      remedy: "Remedy sentence.",
    }, "veryfront.config.ts");

    assertStringIncludes(message, "veryfront.config.ts:2");
    assertStringIncludes(message, "@veryfront/ext-css-lightning");
    assertStringIncludes(message, "Summary sentence.");
    assertStringIncludes(message, "Remedy sentence.");
  });

  it("formats a result-phase rejection without a line or excerpt", () => {
    const message = formatHostedConfigIncompatibility({
      code: "unsupported-hosted-feature",
      reason: "hosted-extensions",
      summary: "Summary sentence.",
      remedy: "Remedy sentence.",
    }, "veryfront.config.ts");

    assertStringIncludes(
      message,
      "veryfront.config.ts cannot be deployed",
      "the message must name the config file that cannot be deployed",
    );
    assertEquals(
      message.includes("veryfront.config.ts:"),
      false,
      "no line is claimed for a result-phase rejection",
    );
    assertEquals(
      message.split("\n").length,
      2,
      "no blank excerpt line is printed",
    );
  });

  it("keeps a credential out of the excerpt it prints", async () => {
    const incompatibility = await findHostedConfigIncompatibility(
      `const client = connect("postgres://admin:hunter2@db.internal.test/app");\n` +
        `export default { title: "Demo" };\n`,
    );

    assertEquals(incompatibility?.line, 1);
    assertEquals(incompatibility?.excerpt?.includes("hunter2"), false);
    assertStringIncludes(incompatibility?.excerpt ?? "", "connect(");
  });

  it("masks a credential before it cuts an over-long line", async () => {
    // The credential starts past character 150, so the mask has to run before
    // the cut: truncating first would split the "user:password@host" shape
    // this masks on and leave the password prefix in the message.
    const padding = "a".repeat(150);
    const incompatibility = await findHostedConfigIncompatibility(
      `const client = connect("${padding}postgres://admin:hunter2@db.internal.test/app");\n` +
        `export default { title: "Demo" };\n`,
    );
    const excerpt = incompatibility?.excerpt ?? "";

    assertEquals(
      excerpt.length,
      161,
      "a truncated excerpt is exactly MAX_SOURCE_EXCERPT_CHARACTERS (160) source characters " +
        "plus the one-character ellipsis marker",
    );
    assertEquals(
      excerpt.endsWith("…"),
      true,
      "a truncated excerpt must end with the ellipsis",
    );
    assertEquals(
      excerpt.includes("hunter2"),
      false,
      "the credential must be redacted before truncation",
    );
    assertEquals(
      excerpt.includes("hunter"),
      false,
      "not even a prefix of the credential may survive the cut",
    );
  });

  it("strips control characters that would repaint the terminal", async () => {
    const incompatibility = await findHostedConfigIncompatibility(
      `const client = connect("\u001b[31mred\u0007rewritten");\n` +
        `export default { title: "Demo" };\n`,
    );
    const excerpt = incompatibility?.excerpt ?? "";

    const controlCharacters = Array.from(excerpt).filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || (code >= 0x7f && code <= 0x9f);
    });

    assertStringIncludes(
      excerpt,
      "connect(",
      "the excerpt must still show the offending call",
    );
    assertEquals(
      controlCharacters,
      [],
      "no control character may reach the terminal that prints the excerpt",
    );
  });

  it("accepts the configuration shapes the hosted evaluator supports", async () => {
    for (
      const source of [
        `export default { title: "Demo" };`,
        `import { defineConfig } from "veryfront";\nexport default defineConfig({ title: "Demo" });`,
        `import { getEnv } from "veryfront";\n` +
        `export default { title: getEnv("TITLE") ?? "Demo" };`,
        `export default { extensions: [{ name: "ext-css-lightning", enabled: false }] };`,
        `export default { security: { auth: { oidc: { issuerEnvVar: "OIDC_ISSUER", clientIdEnvVar: "OIDC_CLIENT_ID", clientSecretEnvVar: "OIDC_CLIENT_SECRET", sessionSecretEnvVar: "VERYFRONT_AUTH_SESSION_SECRET", scopes: ["openid"], claims: { email: "email" } } } } };`,
        `import { getEnv } from "veryfront";\n` +
        `export default { security: { auth: { bearer: { token: getEnv("API_TOKEN") } } } };`,
      ]
    ) {
      assertEquals(
        await findHostedConfigIncompatibility(source),
        null,
        `expected no incompatibility for: ${source}`,
      );
    }
  });

  it("rejects trusted-proxy auth on Veryfront Cloud with an actionable diagnostic", async () => {
    const incompatibility = await findHostedConfigIncompatibility(
      `export default { security: { auth: { trustedProxy: { trustedPeers: ["127.0.0.1"], headers: { subject: "x-auth-subject" } } } } };`,
    );

    assertEquals(incompatibility?.code, "unsupported-hosted-feature");
    assertEquals(incompatibility?.reason, "hosted-trusted-proxy-auth");
    assertStringIncludes(incompatibility?.summary ?? "", "trusted-proxy");
    assertStringIncludes(incompatibility?.summary ?? "", "Veryfront Cloud");
    assertStringIncludes(incompatibility?.remedy ?? "", "OIDC");
  });

  it("refuses a literal config the hosted result policy always rejects", async () => {
    // Nothing here reads the deployment environment, so this evaluation and
    // the hosted one see the same record: the deploy would ship a release that
    // answers 500 to every request.
    for (
      const [source, reason] of [
        [`export default { cache: { dir: ".tenant-cache" } };`, "hosted-cache-directory"],
        [
          `export default { extensions: [{ name: "ext-css-lightning" }] };`,
          "hosted-extensions",
        ],
        [
          `export default { cache: { render: { type: "filesystem" } } };`,
          "hosted-render-cache-backend",
        ],
      ] as const
    ) {
      const incompatibility = await findHostedConfigIncompatibility(source);

      assertEquals(incompatibility?.code, "unsupported-hosted-feature", source);
      assertEquals(incompatibility?.reason, reason, source);
      // The evaluator reports a result rejection against the program, not the
      // key, so no line is claimed for one.
      assertEquals(incompatibility?.line, undefined, source);
      assertEquals(incompatibility?.excerpt, undefined, source);
    }
  });

  it("names the hosted limit rather than the generic literal remedy", async () => {
    const incompatibility = await findHostedConfigIncompatibility(
      `export default { cache: { dir: ".tenant-cache" } };`,
    );

    assertStringIncludes(incompatibility?.summary ?? "", "cache.dir");
    assertStringIncludes(incompatibility?.remedy ?? "", "cache.dir");
  });

  it("is not silenced by a helper name that is only text", async () => {
    // "getEnv" here is a title, not a binding. Nothing in this config reads
    // the environment, so the cache.dir verdict is still the hosted one.
    const incompatibility = await findHostedConfigIncompatibility(
      `export default { cache: { dir: ".tenant-cache" }, title: "getEnv" };\n`,
    );

    assertEquals(incompatibility?.reason, "hosted-cache-directory");
  });

  it("defers on a literal rejection standing beside a real environment read", async () => {
    // A known limit, and the safe direction: the evaluator names the reason it
    // refused, not the path of the value it refused, so nothing here can tell
    // whether ORIGINS reaches cache.dir. Reporting would risk blocking a deploy
    // over a local difference; staying silent leaves the verdict where it was
    // before this check existed, with the hosted runtime.
    assertEquals(
      await findHostedConfigIncompatibility(
        `import { getEnv } from "veryfront";\n` +
          `export default {\n` +
          `  cache: { dir: ".tenant-cache" },\n` +
          `  security: { cors: { origin: getEnv("ORIGINS") } },\n` +
          `};\n`,
      ),
      null,
    );
  });

  it("stays silent about rejections that depend on evaluated values", async () => {
    // The hosted result policy refuses an origin this evaluation cannot
    // produce: ORIGINS is set in the deployment environment, not this one. A
    // caller cannot reach that verdict honestly, so it reports nothing.
    assertEquals(
      await findHostedConfigIncompatibility(
        `import { getEnv } from "veryfront";\n` +
          `export default { security: { cors: { origin: getEnv("ORIGINS") } } };\n`,
      ),
      null,
    );
  });
});
