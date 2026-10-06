import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { HandlerContext } from "#veryfront/types";
import { createHostApplicationInferenceAdmission } from "./application-inference-admission.ts";
import {
  encryptApplicationInferenceToken,
  generateApplicationInferenceEncryptionKeyPair,
} from "./application-inference-crypto.ts";

function context(): HandlerContext {
  return {
    projectDir: "/synthetic-project",
    adapter: createMockAdapter(),
    securityConfig: null,
    projectId: "11111111-1111-4111-8111-111111111111",
    projectSlug: "synthetic-project",
    releaseId: "22222222-2222-4222-8222-222222222222",
    environmentName: "production",
    resolvedEnvironment: "production",
  };
}

function hostEnv(values: Readonly<Record<string, string>>) {
  return (key: string) => values[key];
}

const HOST_ENV = {
  VERYFRONT_API_INTERNAL_USER: "synthetic-user",
  VERYFRONT_API_INTERNAL_PASS: "synthetic-password",
} as const;
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const INFERENCE_TOKEN = "synthetic-inference-token";
const API_ORIGIN = "https://api.veryfront.com";
const BASIC_AUTH = `Basic ${btoa("synthetic-user:synthetic-password")}`;
const EXPIRES_AT = "2030-01-01T00:00:00.000Z";

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = JSON.parse(await request.text());
  assert(body !== null && typeof body === "object" && !Array.isArray(body));
  return body as Record<string, unknown>;
}

function encryptedAdmission(body: Record<string, unknown>, token = INFERENCE_TOKEN) {
  assert(typeof body.inferencePublicKey === "string");
  return {
    runId: RUN_ID,
    expiresAt: EXPIRES_AT,
    encryptedInferenceToken: encryptApplicationInferenceToken({
      publicKey: body.inferencePublicKey,
      runId: RUN_ID,
      expiresAt: EXPIRES_AT,
      inferenceToken: token,
    }),
  };
}

function tamperBase64(value: string): string {
  return `${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`;
}

describe("host application inference admission", () => {
  it("keeps local model authentication unchanged", () => {
    assertEquals(
      createHostApplicationInferenceAdmission(
        new Request("https://synthetic.example.test/api/ag-ui"),
        { ...context(), isLocalProject: true },
      ),
      undefined,
    );
  });
  it("fails closed when host admission credentials are missing", async () => {
    const admit = createHostApplicationInferenceAdmission(
      new Request("https://synthetic.example.test/api/ag-ui"),
      context(),
      { getHostEnv: hostEnv({}) },
    );
    if (!admit) throw new Error("Expected hosted admission");
    await assertRejects(() => admit("assistant"), Error, "admission is unavailable");
  });

  it("posts admission context and finalizes with the admitted credential", async () => {
    const requests: Request[] = [];
    const admit = createHostApplicationInferenceAdmission(
      new Request("https://synthetic.example.test/api/ag-ui"),
      context(),
      {
        getHostEnv: hostEnv(HOST_ENV),
        createOriginBoundFetch: (origin) => async (input, init) => {
          assertEquals(origin, API_ORIGIN);
          const request = new Request(input, init);
          requests.push(request.clone());
          const path = new URL(request.url).pathname;
          if (path === "/internal/application-agui-inference/admissions") {
            return Response.json(encryptedAdmission(await readJsonBody(request.clone())));
          }
          if (path === `/internal/application-agui-inference/runs/${RUN_ID}/finalize`) {
            return Response.json({ ok: true });
          }
          throw new Error(`Unexpected request path ${path}`);
        },
      },
    );
    if (!admit) throw new Error("Expected hosted admission");

    const admission = await admit("assistant");
    await admission.finalize("completed");

    assertEquals(admission.runId, RUN_ID);
    assertEquals(admission.inferenceToken, INFERENCE_TOKEN);
    assertEquals(admission.expiresAt, EXPIRES_AT);
    assertEquals(Object.hasOwn(admission, "then"), true);
    assertEquals(Reflect.get(admission, "then"), undefined);
    assertEquals(requests.length, 2);

    const admissionRequest = requests[0]!;
    assertEquals(admissionRequest.method, "POST");
    assertEquals(new URL(admissionRequest.url).origin, API_ORIGIN);
    assertEquals(
      new URL(admissionRequest.url).pathname,
      "/internal/application-agui-inference/admissions",
    );
    assertEquals(admissionRequest.headers.get("authorization"), BASIC_AUTH);
    assertEquals(admissionRequest.headers.get("content-type"), "application/json");
    const admissionBody = await readJsonBody(admissionRequest);
    assertEquals({
      ...admissionBody,
      requestId: "dynamic-request-id",
    }, {
      projectId: "11111111-1111-4111-8111-111111111111",
      projectSlug: "synthetic-project",
      environmentName: "production",
      releaseId: "22222222-2222-4222-8222-222222222222",
      routePath: "/api/ag-ui",
      requestId: "dynamic-request-id",
      agentId: "assistant",
      inferencePublicKey: admissionBody.inferencePublicKey,
    });
    assert(typeof admissionBody.inferencePublicKey === "string");
    assertEquals(admissionBody.inferencePublicKey.length > 0, true);
    assertEquals(JSON.stringify(admissionBody).includes(INFERENCE_TOKEN), false);

    const finalizeRequest = requests[1]!;
    assertEquals(finalizeRequest.method, "POST");
    assertEquals(new URL(finalizeRequest.url).origin, API_ORIGIN);
    assertEquals(
      new URL(finalizeRequest.url).pathname,
      `/internal/application-agui-inference/runs/${RUN_ID}/finalize`,
    );
    assertEquals(finalizeRequest.headers.get("authorization"), BASIC_AUTH);
    assertEquals(await readJsonBody(finalizeRequest), {
      status: "completed",
      inferenceToken: INFERENCE_TOKEN,
    });
  });

  it("rejects a refused admission without parsing the response body", async () => {
    const admit = createHostApplicationInferenceAdmission(
      new Request("https://synthetic.example.test/api/ag-ui"),
      context(),
      {
        getHostEnv: hostEnv(HOST_ENV),
        createOriginBoundFetch: () => () =>
          Promise.resolve(new Response("{ malformed", { status: 403 })),
      },
    );
    if (!admit) throw new Error("Expected hosted admission");

    await assertRejects(() => admit("assistant"), Error, "admission failed");
  });

  it("rejects malformed successful admission responses", async () => {
    const admit = createHostApplicationInferenceAdmission(
      new Request("https://synthetic.example.test/api/ag-ui"),
      context(),
      {
        getHostEnv: hostEnv(HOST_ENV),
        createOriginBoundFetch: () => () =>
          Promise.resolve(
            Response.json({
              runId: "not-a-uuid",
              expiresAt: "not-a-date",
              encryptedInferenceToken: {
                ephemeralPublicKey: "",
                iv: "",
                tag: "",
                ciphertext: "",
              },
            }),
          ),
      },
    );
    if (!admit) throw new Error("Expected hosted admission");

    await assertRejects(() => admit("assistant"));
  });

  it("rejects refused finalization responses", async () => {
    const admit = createHostApplicationInferenceAdmission(
      new Request("https://synthetic.example.test/api/ag-ui"),
      context(),
      {
        getHostEnv: hostEnv(HOST_ENV),
        createOriginBoundFetch: () => async (input, init) => {
          const request = new Request(input, init);
          const path = new URL(request.url).pathname;
          if (path === "/internal/application-agui-inference/admissions") {
            return Response.json(encryptedAdmission(await readJsonBody(request.clone())));
          }
          if (path === `/internal/application-agui-inference/runs/${RUN_ID}/finalize`) {
            return new Response("refused", { status: 500 });
          }
          throw new Error(`Unexpected request path ${path}`);
        },
      },
    );
    if (!admit) throw new Error("Expected hosted admission");

    const admission = await admit("assistant");

    await assertRejects(() => admission.finalize("failed"), Error, "finalization failed");
  });

  it("rejects tampered encrypted admission responses", async () => {
    const admit = createHostApplicationInferenceAdmission(
      new Request("https://synthetic.example.test/api/ag-ui"),
      context(),
      {
        getHostEnv: hostEnv(HOST_ENV),
        createOriginBoundFetch: () => async (input, init) => {
          const request = new Request(input, init);
          const body = await readJsonBody(request.clone());
          const encrypted = encryptedAdmission(body);
          return Response.json({
            ...encrypted,
            encryptedInferenceToken: {
              ...encrypted.encryptedInferenceToken,
              tag: tamperBase64(encrypted.encryptedInferenceToken.tag),
            },
          });
        },
      },
    );
    if (!admit) throw new Error("Expected hosted admission");

    await assertRejects(() => admit("assistant"));
  });

  it("rejects encrypted admissions for a different key", async () => {
    const other = generateApplicationInferenceEncryptionKeyPair();
    const admit = createHostApplicationInferenceAdmission(
      new Request("https://synthetic.example.test/api/ag-ui"),
      context(),
      {
        getHostEnv: hostEnv(HOST_ENV),
        createOriginBoundFetch: () => () =>
          Promise.resolve(Response.json({
            runId: RUN_ID,
            expiresAt: EXPIRES_AT,
            encryptedInferenceToken: encryptApplicationInferenceToken({
              publicKey: other.publicKey,
              runId: RUN_ID,
              expiresAt: EXPIRES_AT,
              inferenceToken: INFERENCE_TOKEN,
            }),
          })),
      },
    );
    if (!admit) throw new Error("Expected hosted admission");

    await assertRejects(() => admit("assistant"));
  });

  it("rejects an oversized response instead of retaining an unbounded token", async () => {
    const admit = createHostApplicationInferenceAdmission(
      new Request("https://synthetic.example.test/api/ag-ui"),
      context(),
      {
        getHostEnv: hostEnv(HOST_ENV),
        createOriginBoundFetch: () => () => Promise.resolve(new Response("x".repeat(40_001))),
      },
    );
    if (!admit) throw new Error("Expected hosted admission");
    await assertRejects(() => admit("assistant"), Error, "exceeded its limit");
  });

  it("ignores inherited admission option accessors", () => {
    const options = Object.create({
      get createOriginBoundFetch() {
        throw new Error("inherited transport getter must not run");
      },
    }) as {
      getHostEnv: (key: string) => string | undefined;
    };
    options.getHostEnv = hostEnv({
      VERYFRONT_API_INTERNAL_USER: "synthetic-user",
      VERYFRONT_API_INTERNAL_PASS: "synthetic-password",
    });

    const admit = createHostApplicationInferenceAdmission(
      new Request("https://synthetic.example.test/api/ag-ui"),
      context(),
      options,
    );

    assertEquals(typeof admit, "function");
  });

  it("rejects accessor admission options without invoking them", () => {
    assertThrows(
      () =>
        createHostApplicationInferenceAdmission(
          new Request("https://synthetic.example.test/api/ag-ui"),
          context(),
          Object.create(null, {
            getHostEnv: {
              get() {
                throw new Error("own getter must not run");
              },
            },
          }),
        ),
      TypeError,
      "must be a data property",
    );
  });
});
