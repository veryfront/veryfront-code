import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import type { components, operations, paths } from "../contract/runs-api.generated.ts";
import {
  createRunsSdk,
  type RunsInput,
  type RunsOperationId,
  type RunsOutput,
  type RunsPaginatedOperationId,
  type RunsProblem,
  runsProblemOf,
  type RunsResult,
  type RunStreamFrame,
} from "./client.ts";
import {
  createFixtureTransport,
  fixtureResponse,
  RUNS_OPERATION_FIXTURES,
} from "./client.test-helpers.ts";
import { RUNS_OPERATIONS } from "./operations.ts";

type Schemas = components["schemas"];
type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true
  : false;
type Routes = typeof RUNS_OPERATIONS;
type ContractOperation<K extends RunsOperationId> =
  paths[Routes[K]["path"]][Lowercase<Routes[K]["method"]> & keyof paths[Routes[K]["path"]]];
type IsEventStream<K extends RunsOperationId> = operations[K]["responses"] extends
  { 200: { content: { "text/event-stream": string } } } ? true : false;

// Compile-time checks: `deno check` and the CI test typecheck (`lint:test-typecheck`) enforce them.
export type RunsSdkTypeChecks = [
  // Every route resolves to exactly its operation in the pinned `paths`.
  Expect<Equal<{ [K in RunsOperationId]: ContractOperation<K> }, operations>>,
  // Only the event-stream operation is flagged as a stream.
  Expect<
    Equal<
      { [K in RunsOperationId]: IsEventStream<K> },
      { [K in RunsOperationId]: Routes[K] extends { stream: true } ? true : false }
    >
  >,
  Expect<Equal<RunsOutput<"getRun">, Schemas["Run"]>>,
  Expect<Equal<RunsOutput<"createRun">, Schemas["CreatedRun"]>>,
  Expect<Equal<RunsOutput<"deleteRun">, undefined>>,
  Expect<Equal<RunsResult<"streamRunEvents">, AsyncIterable<RunStreamFrame>>>,
  Expect<Equal<RunsInput<"createRun">["body"], Schemas["CreateRunRequest"]>>,
  Expect<Equal<RunsInput<"createRun">["headers"], { "Idempotency-Key": string }>>,
  Expect<
    Equal<
      RunsPaginatedOperationId,
      | "listRuns"
      | "listProjectRuns"
      | "listConversationRuns"
      | "listRunEvents"
      | "listRunInputRequests"
      | "listConversationInputRequests"
      | "listProjectWebhookRuns"
      | "listEvalRuns"
      | "listRunChildRuns"
      | "listConversationChildRuns"
    >
  >,
];

const BASE_URL = "https://api.example.test";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

const FIXTURE_INPUTS = {
  createRun: RUNS_OPERATION_FIXTURES.createRun.input,
  finalizeRun: RUNS_OPERATION_FIXTURES.finalizeRun.input,
};
const FIXTURE_RUN = RUNS_OPERATION_FIXTURES.getRun.response.body;

function sdkWith(responses: Response[], credential = { bearer: "user-token" }) {
  const fixture = createFixtureTransport(responses);
  return {
    sdk: createRunsSdk({ baseUrl: BASE_URL, transport: fixture.transport, credential }),
    ...fixture,
  };
}

/** The `VeryfrontError` that `fn` rejects with. */
async function rejection(fn: () => Promise<unknown>): Promise<VeryfrontError> {
  return await assertRejects(fn, VeryfrontError) as VeryfrontError;
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of items) collected.push(item);
  return collected;
}

function problemResponse(problem: RunsProblem): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("Runs target SDK", () => {
  it("exposes one method per contract operation", () => {
    const { sdk } = sdkWith([]);
    const operationIds = Object.keys(RUNS_OPERATIONS).sort();
    assertEquals(operationIds.length, 31);
    assertEquals(Object.keys(RUNS_OPERATION_FIXTURES).sort(), operationIds);
    for (const operationId of operationIds) {
      assertEquals(typeof sdk[operationId as RunsOperationId], "function", operationId);
    }
  });

  it("serializes every operation's fixture request and returns its typed response", async () => {
    for (const [operationId, fixture] of Object.entries(RUNS_OPERATION_FIXTURES)) {
      const id = operationId as RunsOperationId;
      const { sdk, requests } = sdkWith([fixtureResponse(id)]);
      const method = sdk[id] as (input: unknown) => unknown;
      const result = method(fixture.input);
      const received = "stream" in RUNS_OPERATIONS[id]
        ? await collect(result as AsyncIterable<RunStreamFrame>)
        : await result;

      assertEquals(requests.length, 1, operationId);
      const [request] = requests;
      assert(request, operationId);
      assertEquals(request.method, RUNS_OPERATIONS[id].method, operationId);
      assertEquals(request.url, `${BASE_URL}${fixture.url}`, operationId);
      assertEquals(request.headers.get("Authorization"), "Bearer user-token", operationId);
      const input = fixture.input as { headers?: Record<string, string>; body?: unknown };
      for (const [name, value] of Object.entries(input.headers ?? {})) {
        assertEquals(request.headers.get(name), value, `${operationId} ${name}`);
      }
      if (input.body === undefined) {
        assertEquals(request.body, null, operationId);
      } else {
        assertEquals(request.headers.get("Content-Type"), "application/json", operationId);
        assertEquals(await request.json(), input.body, operationId);
      }

      if (typeof fixture.response.body === "string") {
        const [frame] = received as RunStreamFrame[];
        assertEquals(frame?.id, "42", operationId);
        assertEquals(frame?.event.type, "MODEL_CALL_COMPLETED", operationId);
      } else {
        assertEquals(received, fixture.response.body, operationId);
      }
    }
  });

  it("repeats array query parameters and omits unset ones", async () => {
    const { sdk, requests } = sdkWith([fixtureResponse("listRuns")]);
    await sdk.listRuns({
      query: {
        status: ["running", "waiting"],
        target_type: ["task"],
        root_only: "true",
        limit: 50,
        cursor: undefined,
      },
    });
    assertEquals(
      requests[0]?.url,
      `${BASE_URL}/runs?status=running&status=waiting&target_type=task&root_only=true&limit=50`,
    );
  });

  it("encodes path parameters and tolerates a trailing slash on the base URL", async () => {
    const fixture = createFixtureTransport([fixtureResponse("listProjectRuns")]);
    const sdk = createRunsSdk({ baseUrl: `${BASE_URL}/`, transport: fixture.transport });
    await sdk.listProjectRuns({ path: { project_reference: "team/a b" } });
    assertEquals(fixture.requests[0]?.url, `${BASE_URL}/projects/team%2Fa%20b/runs`);
  });

  it("forwards the configured credential, an API key, or a per-call execution credential", async () => {
    const { sdk, requests } = sdkWith([fixtureResponse("getRun"), fixtureResponse("finalizeRun")]);
    await sdk.getRun({ path: { run_id: RUN_ID } });
    await sdk.finalizeRun(FIXTURE_INPUTS.finalizeRun, {
      credential: { bearer: "execution-token" },
    });
    assertEquals(requests.map((request) => request.headers.get("Authorization")), [
      "Bearer user-token",
      "Bearer execution-token",
    ]);

    const keyed = createFixtureTransport([fixtureResponse("getRun"), fixtureResponse("getRun")]);
    const keyedSdk = createRunsSdk({
      baseUrl: BASE_URL,
      transport: keyed.transport,
      credential: { apiKey: "<API_KEY>" },
    });
    await keyedSdk.getRun({ path: { run_id: RUN_ID } });
    assertEquals(keyed.requests[0]?.headers.get("X-API-Key"), "<API_KEY>");
    assertEquals(keyed.requests[0]?.headers.get("Authorization"), null);

    const anonymous = createFixtureTransport([fixtureResponse("listRunEventTypes")]);
    await createRunsSdk({ baseUrl: BASE_URL, transport: anonymous.transport }).listRunEventTypes();
    assertEquals(anonymous.requests[0]?.headers.get("Authorization"), null);
    assertEquals(anonymous.requests[0]?.headers.get("X-API-Key"), null);
  });

  it("passes the abort signal to the transport", async () => {
    const { sdk, requests } = sdkWith([fixtureResponse("getRun")]);
    const controller = new AbortController();
    await sdk.getRun({ path: { run_id: RUN_ID } }, { signal: controller.signal });
    controller.abort();
    assertEquals(requests[0]?.signal.aborted, true);
  });

  it("hands success headers to onHeaders so a getRun ETag can guard updateRun", async () => {
    const { sdk, requests } = sdkWith([
      Response.json(FIXTURE_RUN, { headers: { ETag: '"run-version-7"' } }),
      fixtureResponse("updateRun"),
    ]);
    let etag: string | null = null;
    await sdk.getRun({ path: { run_id: RUN_ID } }, {
      onHeaders: (headers) => etag = headers.get("ETag"),
    });
    assert(etag);
    await sdk.updateRun({
      path: { run_id: RUN_ID },
      headers: { "If-Match": etag },
      body: { title: "Renamed" },
    });
    assertEquals(requests[1]?.headers.get("If-Match"), '"run-version-7"');
  });

  it("maps a malformed success body or stream frame to an API client error", async () => {
    const { sdk } = sdkWith([
      new Response("<html>", { status: 200 }),
      streamResponse(["id: 1\ndata: {not json\n\n"]),
    ]);
    const bodyError = await rejection(() => sdk.getRun({ path: { run_id: RUN_ID } }));
    assertEquals(bodyError.status, 502);
    const frameError = await rejection(() =>
      collect(sdk.streamRunEvents({ path: { run_id: RUN_ID } }))
    );
    assertEquals(frameError.status, 502);
  });

  it("follows page_info.next with unchanged filters until it is null", async () => {
    const run = FIXTURE_RUN;
    const { sdk, requests } = sdkWith([
      Response.json({ data: [{ ...run, id: "run-1" }], page_info: { next: "run-1" } }),
      Response.json({ data: [{ ...run, id: "run-2" }], page_info: { next: null } }),
    ]);
    const items = await collect(
      sdk.paginate("listRuns", { query: { status: ["running"], limit: 1 } }),
    );
    assertEquals(items.map((item) => item.id), ["run-1", "run-2"]);
    assertEquals(requests.map((request) => new URL(request.url).search), [
      "?status=running&limit=1",
      "?status=running&limit=1&cursor=run-1",
    ]);
  });

  it("stops paginating when the server repeats the request cursor", async () => {
    const { sdk } = sdkWith([
      Response.json({ data: [], page_info: { next: "same" } }),
    ]);
    const error = await rejection(() =>
      collect(
        sdk.paginate("listRunChildRuns", { path: { run_id: RUN_ID }, query: { cursor: "same" } }),
      )
    );
    assertEquals(error.status, 502);
  });

  it("parses event-stream frames split across chunks, CRLF line ends and keep-alive comments", async () => {
    const first = JSON.stringify({ type: "RUN_STARTED", threadId: "t", runId: RUN_ID });
    const second = JSON.stringify({ type: "STEP_STARTED", stepName: "plan" });
    const { sdk, requests } = sdkWith([
      streamResponse([
        `: keep-alive\r\n\r\nid: 7\r\ndata: ${first.slice(0, 10)}`,
        `${first.slice(10)}\r`,
        `\n\r\n`,
        `id: 8\ndata: ${second}\n\n`,
      ]),
    ]);
    const frames = await collect(
      sdk.streamRunEvents({ path: { run_id: RUN_ID }, headers: { "Last-Event-ID": "6" } }),
    );
    assertEquals(requests[0]?.headers.get("Last-Event-ID"), "6");
    assertEquals(requests[0]?.headers.get("Accept"), "text/event-stream");
    assertEquals(frames, [
      { id: "7", event: JSON.parse(first) },
      { id: "8", event: JSON.parse(second) },
    ]);
  });

  it("maps a problem response to an error that keeps the domain code and status", async () => {
    const problem: RunsProblem = {
      type: "https://veryfront.com/problems/conflict",
      title: "Conflict",
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
      detail: "The idempotency key was used with a different request.",
      instance: "/runs",
    };
    const { sdk } = sdkWith([problemResponse(problem)]);
    const error = await rejection(() => sdk.createRun(FIXTURE_INPUTS.createRun));
    assertEquals(error.status, 409);
    assertEquals(error.message, problem.detail);
    assertEquals(runsProblemOf(error), problem);
    assertEquals((error.context as { operationId?: string }).operationId, "createRun");
  });

  it("maps a stream error and a non-problem error body to problems", async () => {
    const { sdk } = sdkWith([
      problemResponse({ type: "about:blank", title: "Forbidden", status: 403, code: "FORBIDDEN" }),
      new Response("upstream unavailable", { status: 502, statusText: "Bad Gateway" }),
    ]);
    const streamError = await rejection(() =>
      collect(sdk.streamRunEvents({ path: { run_id: RUN_ID } }))
    );
    assertEquals(runsProblemOf(streamError)?.code, "FORBIDDEN");

    const gatewayError = await rejection(() => sdk.getRun({ path: { run_id: RUN_ID } }));
    assertEquals(runsProblemOf(gatewayError), {
      type: "about:blank",
      title: "Bad Gateway",
      status: 502,
      code: "UNEXPECTED_RESPONSE",
    });
    assertEquals(runsProblemOf(new Error("other")), undefined);
  });

  it("rejects a call that is missing a path parameter before sending it", async () => {
    const { sdk, requests } = sdkWith([]);
    // @ts-expect-error run_id is required by the contract.
    await assertRejects(() => sdk.getRun({ path: {} }), TypeError, "run_id");
    assertEquals(requests.length, 0);
  });
});
