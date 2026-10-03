import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as publicTargetModule from "veryfront/runs/target";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createRunsSdk } from "#veryfront/runs/target/client.ts";
import {
  createFixtureTransport,
  fixtureResponse,
  RUNS_OPERATION_FIXTURES,
} from "#veryfront/runs/target/client.test-helpers.ts";
import { createRunsApiTransport } from "#veryfront/runs/target/transport.ts";

const BASE_URL = "https://api.example.test";
const NO_RETRY = { maxRetries: 0, initialDelay: 0, maxDelay: 0 };

async function sendGetRun(
  transport: ReturnType<typeof createRunsApiTransport>,
  responses: Response[],
): Promise<{ requests: Request[]; run: unknown }> {
  const queue = [...responses];
  const requests: Request[] = [];
  const run = await withMockFetch((url, init) => {
    requests.push(new Request(url, init as RequestInit));
    const response = queue.shift();
    return response ? Promise.resolve(response) : Promise.reject(new Error("no response"));
  }, () => createRunsSdk({ transport }).getRun(RUNS_OPERATION_FIXTURES.getRun.input));
  return { requests, run };
}

describe("veryfront/runs/target", () => {
  it("types an operation through the public entry point", async () => {
    const getRun: publicTargetModule.RunsInput<"getRun"> = RUNS_OPERATION_FIXTURES.getRun.input;
    const { transport, requests } = createFixtureTransport([fixtureResponse("getRun")]);
    const sdk = publicTargetModule.createRunsSdk({ transport });
    const run: publicTargetModule.RunsOutput<"getRun"> = await sdk.getRun(getRun);
    assertEquals(run, RUNS_OPERATION_FIXTURES.getRun.response.body);
    assertEquals(requests.map(({ url }) => new URL(url).pathname), [
      RUNS_OPERATION_FIXTURES.getRun.url,
    ]);
  });
});

describe("createRunsApiTransport", () => {
  it("sends the token as a bearer credential to the configured origin", async () => {
    const transport = createRunsApiTransport({
      baseUrl: BASE_URL,
      getToken: () => "user-token",
      retry: NO_RETRY,
    });
    const { requests, run } = await sendGetRun(transport, [fixtureResponse("getRun")]);
    assertEquals(run, RUNS_OPERATION_FIXTURES.getRun.response.body);
    assertEquals(requests.map(({ url }) => url), [
      `${BASE_URL}${RUNS_OPERATION_FIXTURES.getRun.url}`,
    ]);
    assertEquals(requests[0]?.headers.get("Authorization"), "Bearer user-token");
    assertEquals(requests[0]?.headers.get("X-API-Key"), null);
  });

  it("sends a project API key as X-API-Key", async () => {
    const transport = createRunsApiTransport({
      baseUrl: BASE_URL,
      getToken: () => "project-key",
      authMode: "api-key",
      retry: NO_RETRY,
    });
    const { requests } = await sendGetRun(transport, [fixtureResponse("getRun")]);
    assertEquals(requests[0]?.headers.get("X-API-Key"), "project-key");
    assertEquals(requests[0]?.headers.get("Authorization"), null);
  });

  it("retries a failed attempt by default", async () => {
    const transport = createRunsApiTransport({ baseUrl: BASE_URL, getToken: () => "user-token" });
    const { requests, run } = await sendGetRun(transport, [
      new Response("unavailable", { status: 503 }),
      fixtureResponse("getRun"),
    ]);
    assertEquals(requests.length, 2);
    assertEquals(run, RUNS_OPERATION_FIXTURES.getRun.response.body);
  });
});
