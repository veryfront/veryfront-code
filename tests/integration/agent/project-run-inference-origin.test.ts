/**
 * Where a project-run inference credential is sent, observed in a fresh Deno
 * process. The in-process test preload keeps its own environment view, which
 * would hide a live `Deno.env.set` from the code under test; a child process
 * loads the framework the way a server does, so project code that changes the
 * environment after startup is seen exactly as it would be in production.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const INFERENCE_TOKEN = "project-run-origin-token";
const resolve = (path: string) => JSON.stringify(import.meta.resolve(path));

type ChildResult = { requests: Array<{ origin: string; bearer: boolean }> };

/**
 * Loads the credential module in a child, then optionally runs `projectCode`
 * (standing in for a project module) before the credential is used.
 */
async function runChild(input: {
  hostEnv?: Record<string, string>;
  beforeFrameworkLoad?: string;
  projectCode?: string;
}): Promise<ChildResult> {
  const script = `
    const requests = [];
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        origin: new URL(request.url).origin,
        bearer: (request.headers.get("Authorization") ?? "").includes(${
    JSON.stringify(INFERENCE_TOKEN)
  }),
      });
      return new Response(
        'data: {"choices":[{"finish_reason":"stop"}]}\\n\\ndata: [DONE]\\n\\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
    ${input.beforeFrameworkLoad ?? ""}
    const { installMockFetch } = await import(${resolve("#veryfront/testing/mock-fetch.ts")});
    installMockFetch(globalThis.fetch);
    const { seedServedCatalogForTests } = await import(${
    resolve("#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts")
  });
    seedServedCatalogForTests();
    const credential = await import(${
    resolve("#veryfront/agent/runtime/project-run-inference-credential.ts")
  });
    ${input.projectCode ?? ""}
    await credential.runWithProjectRunInferenceCredential(${
    JSON.stringify(INFERENCE_TOKEN)
  }, async () => {
      const model = credential.createProjectRunInferenceModelResolver()("veryfront-cloud/openai/gpt-test");
      const result = await model.doStream({ prompt: [] });
      const reader = result.stream.getReader();
      while (!(await reader.read()).done) {}
    });
    console.log(JSON.stringify({ requests }));
  `;
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      `--config=${new URL("../../../deno.json", import.meta.url).pathname}`,
      script,
    ],
    env: {
      VERYFRONT_API_TOKEN: "broader-project-runtime-token",
      VERYFRONT_PROJECT_SLUG: "provider-test-project",
      ...input.hostEnv,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = new TextDecoder().decode(output.stderr);
  assertEquals(output.code, 0, stderr);
  const lines = new TextDecoder().decode(output.stdout).trim().split("\n");
  return JSON.parse(lines[lines.length - 1]!) as ChildResult;
}

describe("project-run inference credential origin", () => {
  it("sends the credential to a host-configured public origin (negative control)", async () => {
    const { requests } = await runChild({
      hostEnv: { VERYFRONT_PUBLIC_API_BASE_URL: "https://public-api.example" },
    });

    assertEquals(requests, [{ origin: "https://public-api.example", bearer: true }]);
  });

  it("ignores project code that sets the public origin after startup", async () => {
    const { requests } = await runChild({
      projectCode: `Deno.env.set("VERYFRONT_PUBLIC_API_BASE_URL", "https://evil.example");`,
    });

    assertEquals(requests, [{ origin: "https://api.veryfront.com", bearer: true }]);
  });

  it("keeps the host origin when project code overrides it after startup", async () => {
    const { requests } = await runChild({
      hostEnv: { VERYFRONT_PUBLIC_API_BASE_URL: "https://public-api.example" },
      projectCode: `Deno.env.set("VERYFRONT_PUBLIC_API_BASE_URL", "https://evil.example");`,
    });

    assertEquals(requests, [{ origin: "https://public-api.example", bearer: true }]);
  });

  it("ignores a public origin that came from a project .env file", async () => {
    const { requests } = await runChild({
      beforeFrameworkLoad: `
        Deno.env.set("VERYFRONT_PUBLIC_API_BASE_URL", "https://evil.example");
        const env = await import(${resolve("#veryfront/platform/compat/process/env.ts")});
        env.markEnvFileValue("VERYFRONT_PUBLIC_API_BASE_URL");
      `,
    });

    assertEquals(requests, [{ origin: "https://api.veryfront.com", bearer: true }]);
  });
});
