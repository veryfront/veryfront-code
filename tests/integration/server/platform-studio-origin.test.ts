import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const root = "verified-0924.127.0.0.1.sslip.io";
const origin = `https://${root}:58443`;

async function runWithOperatorOrigin(code: string): Promise<Record<string, unknown>> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--no-check", code],
    cwd: Deno.cwd(),
    env: { PLATFORM_DOMAIN_SUFFIXES: root, PLATFORM_STUDIO_ORIGIN: origin },
  }).output();
  assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
  return JSON.parse(new TextDecoder().decode(result.stdout));
}

function frameAncestors(policy: string): string[] {
  const directive = policy.split(";").map((part) => part.trim()).find((part) =>
    part.startsWith("frame-ancestors ")
  );
  return directive?.split(/\s+/).slice(1) ?? [];
}

describe("host-owned Studio origin", () => {
  it("captures the operator origin before later host environment changes", async () => {
    const observed = await runWithOperatorOrigin(`
      import { buildCSP } from "#veryfront/security/http/response/security-handler.ts";
      const first = buildCSP(false, "n", null, undefined, true);
      Deno.env.set("PLATFORM_STUDIO_ORIGIN", "https://evil.example.test");
      const second = buildCSP(false, "n", null, undefined, true);
      console.log(JSON.stringify({first, second}));
    `);
    assertEquals(observed.first, observed.second);
  });

  it("adds only the exact operator origin to managed pages", async () => {
    const observed = await runWithOperatorOrigin(`
      import { buildCSP } from "#veryfront/security/http/response/security-handler.ts";
      console.log(JSON.stringify({
        managed: buildCSP(false, "n", null, undefined, true),
        managedWithProjectEnv: buildCSP(false, "n", null,
          {env: {get: (key) => key === "PLATFORM_STUDIO_ORIGIN"
            ? "https://evil.example.test" : undefined}}, true),
        custom: buildCSP(false, "n", null, undefined, false),
      }));
    `);
    assertEquals(frameAncestors(observed.managed as string), [
      "'self'",
      "https://veryfront.com",
      "https://veryfront.org",
      origin,
    ]);
    assertEquals(frameAncestors(observed.custom as string), ["'none'"]);
    assertEquals(observed.managedWithProjectEnv, observed.managed);
  });

  it("serves a bridge script bound to the same host-owned Studio origin", async () => {
    const observed = await runWithOperatorOrigin(`
      import { StudioBridgeModulesHandler } from "#veryfront/server/handlers/studio/bridge-modules.handler.ts";
      const result = await new StudioBridgeModulesHandler().handle(
        new Request("https://app.preview.example.test/_veryfront/studio-bridge.js"), {});
      const script = await result.response.text();
      const resolve = new Function(
        "window", "globalThis", script + "\\nreturn resolveTrustedStudioOrigin;",
      )({location: {search: ""}}, {__VF_BRIDGE_CONFIG__: {debugSkipInit: true}});
      const origin = ${JSON.stringify(origin)};
      console.log(JSON.stringify({
        status: result.response.status,
        hasOrigin: script.includes(JSON.stringify(origin)),
        hasMarker: script.includes("__VF_OPERATOR_STUDIO_ORIGIN__"),
        hasEvil: script.includes("https://evil.example.test"),
        exactAccepted: resolve(origin) === origin,
        tenantRefused: resolve("https://app.preview.${root}:58443") === null,
        wrongPortRefused: resolve("https://${root}:58444") === null,
      }));
    `);
    assertEquals(observed, {
      status: 200,
      hasOrigin: true,
      hasMarker: false,
      hasEvil: false,
      exactAccepted: true,
      tenantRefused: true,
      wrongPortRefused: true,
    });
  });
});
