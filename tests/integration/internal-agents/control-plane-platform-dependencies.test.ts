import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createControlPlaneSignature } from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";

const program = `
import "#veryfront/schemas/_test-setup.ts";
import { verifyControlPlaneRequest, getVerifiedControlPlanePlatformDependencies } from "#veryfront/internal-agents/control-plane-auth.ts";
import { createCtx } from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { loadEnv } from "#veryfront/utils/env-loader.ts";
const data = JSON.parse(await new Response(Deno.stdin.readable).text());
if (data.projectEnv) {
  const directory = await Deno.makeTempDir();
  try { await Deno.writeTextFile(directory + "/.env", 'CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY="' + data.publicKeyPem + '"\\n'); await loadEnv({ cwd: directory }); }
  finally { await Deno.remove(directory, { recursive: true }); }
}
if (data.projectEnv && Deno.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY") !== data.publicKeyPem) throw new Error("Project env control did not load its key");
if (data.mutate) Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", data.mutate);
if (data.inheritedDependencies) {
  const own = Object.hasOwn;
  Object.defineProperty(Object.prototype, "platformToolDependencies", { value: data.inheritedDependencies, configurable: true });
  Object.hasOwn = (value, key) => key === "platformToolDependencies" || own(value, key);
}

const claims = await verifyControlPlaneRequest(new Request("https://veryfront.test/api/control-plane/runs/run-1/stream", { method: "POST", headers: { "x-veryfront-control-plane-jws": data.jws } }), createCtx(data.publicKeyPem), data.body);
const scope = { projectId: data.executionProjectId ?? "proj-1", runId: "run-1", agentId: "intake-agent" };
console.log(JSON.stringify({ accepted: getVerifiedControlPlanePlatformDependencies(claims, scope) ?? null, clone: getVerifiedControlPlanePlatformDependencies({...claims}, scope) ?? null, otherRun: getVerifiedControlPlanePlatformDependencies(claims, {...scope, runId:"run-child"}) ?? null, otherAgent: getVerifiedControlPlanePlatformDependencies(claims, {...scope, agentId:"foreign"}) ?? null, otherProject: getVerifiedControlPlanePlatformDependencies(claims, {...scope, projectId:data.executionProjectId ? "proj-1" : "foreign"}) ?? null }));
`;

describe("pinned operator platform-dependency authority", () => {
  it("accepts only operator-signed immutable scope and rejects adapter-only or later tenant keys", async () => {
    const dependencies = [{ toolId: "intake", platformTools: ["outlook__upload_attachment"] }];
    const body = JSON.stringify({
      run: { runId: "run-1", agentId: "intake-agent", project: { projectId: "proj-1" } },
      platformToolDependencies: dependencies,
    });
    const operator = await createControlPlaneSignature(body);
    const tenant = await createControlPlaneSignature(body);
    const unsignedMapBody = JSON.stringify({
      run: { runId: "run-1", agentId: "intake-agent", project: { projectId: "proj-1" } },
    });
    const withoutMap = await createControlPlaneSignature(unsignedMapBody);
    for (
      const control of [
        "operator",
        "mutation",
        "adapter-only",
        "project-env",
        "inherited-map",
      ] as const
    ) {
      const signingOperator = control === "inherited-map" ? withoutMap : operator;
      const signed = control === "adapter-only" || control === "project-env"
        ? tenant
        : signingOperator;
      const env: Record<string, string> = { DENO_TESTING: "0", NODE_ENV: "production" };
      if (Deno.env.get("HOME")) env.HOME = Deno.env.get("HOME")!;
      if (Deno.env.get("DENO_DIR")) env.DENO_DIR = Deno.env.get("DENO_DIR")!;
      if (control !== "project-env") {
        env.CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY = signingOperator.publicKeyPem;
      }
      const child = new Deno.Command(Deno.execPath(), {
        args: ["eval", "--config", "deno.json", program],
        clearEnv: true,
        env,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const writer = child.stdin.getWriter();
      await writer.write(
        new TextEncoder().encode(
          JSON.stringify({
            body: control === "inherited-map" ? unsignedMapBody : body,
            ...signed,
            inheritedDependencies: control === "inherited-map" ? dependencies : undefined,
            mutate: control === "mutation" ? tenant.publicKeyPem : undefined,
            projectEnv: control === "project-env",
          }),
        ),
      );
      await writer.close();
      const output = await child.output();
      assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
      const result = JSON.parse(new TextDecoder().decode(output.stdout).trim().split("\n").at(-1)!);
      assertEquals(result, {
        accepted: control === "operator" || control === "mutation" ? dependencies : null,
        clone: null,
        otherRun: null,
        otherAgent: null,
        otherProject: null,
      }, control);
    }
  });
  it("binds shared grants to the consuming project and rejects inconsistent signed project scopes", async () => {
    const dependencies = [{ toolId: "intake", platformTools: ["outlook__upload_attachment"] }];
    for (
      const control of [
        "shared",
        "wrong-source",
        "wrong-execution",
        "missing-source",
        "missing-execution",
        "ordinary-wrong-project",
      ] as const
    ) {
      const body = JSON.stringify({
        run: {
          runId: "run-1",
          agentId: "intake-agent",
          project: { projectId: "consumer-project" },
        },
        ...(control === "missing-source" || control === "ordinary-wrong-project" ? {} : {
          sourceProject: { projectId: control === "wrong-source" ? "foreign-source" : "proj-1" },
        }),
        ...(control === "missing-execution" || control === "ordinary-wrong-project" ? {} : {
          executionProject: {
            projectId: control === "wrong-execution" ? "foreign-consumer" : "consumer-project",
          },
        }),
        platformToolDependencies: dependencies,
      });
      const signed = await createControlPlaneSignature(body);
      const env: Record<string, string> = {
        DENO_TESTING: "0",
        NODE_ENV: "production",
        CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: signed.publicKeyPem,
      };
      if (Deno.env.get("HOME")) env.HOME = Deno.env.get("HOME")!;
      if (Deno.env.get("DENO_DIR")) env.DENO_DIR = Deno.env.get("DENO_DIR")!;
      const child = new Deno.Command(Deno.execPath(), {
        args: ["eval", "--config", "deno.json", program],
        clearEnv: true,
        env,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const writer = child.stdin.getWriter();
      await writer.write(
        new TextEncoder().encode(
          JSON.stringify({ body, ...signed, executionProjectId: "consumer-project" }),
        ),
      );
      await writer.close();
      const output = await child.output();
      assertEquals(
        output.code === 0,
        control === "shared",
        control + ": " + new TextDecoder().decode(output.stderr),
      );
      if (control === "shared") {
        const result = JSON.parse(
          new TextDecoder().decode(output.stdout).trim().split("\n").at(-1)!,
        );
        assertEquals(result, {
          accepted: dependencies,
          clone: null,
          otherRun: null,
          otherAgent: null,
          otherProject: null,
        });
      }
    }
  });
});
