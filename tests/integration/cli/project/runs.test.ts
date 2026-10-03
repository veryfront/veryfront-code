import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { parseCliArgs } from "../../../../cli/shared/args.ts";
import { runProjectRuns, RUNS_COMMANDS } from "../../../../cli/commands/project/runs.ts";
import { createRunsSdk, type RunsOperationId } from "#veryfront/runs/target/client.ts";
import { RUNS_OPERATIONS } from "#veryfront/runs/target/operations.ts";
import {
  createFixtureTransport,
  fixtureResponse,
  RUNS_OPERATION_FIXTURES,
} from "#veryfront/runs/target/client.test-helpers.ts";

function argv(id: RunsOperationId): string[] {
  const fixture = RUNS_OPERATION_FIXTURES[id];
  const input = fixture.input as {
    path?: Record<string, string>;
    query?: unknown;
    headers?: Record<string, string>;
    body?: unknown;
  };
  const args = ["project", "runs", RUNS_COMMANDS[id]];
  for (const [name, value] of Object.entries(input.path ?? {})) {
    args.push(`--${name.replaceAll("_", "-")}`, String(value));
  }
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    args.push(`--${name.toLowerCase()}`, String(value));
  }
  if (input.query) args.push("--query", JSON.stringify(input.query));
  if (input.body !== undefined) args.push("--body", JSON.stringify(input.body));
  return args;
}

async function execute(args: string[], responses: Response[], token = "user-token") {
  const fixture = createFixtureTransport(responses, () => token);
  const output: unknown[] = [];
  await runProjectRuns(
    parseCliArgs(args),
    createRunsSdk({ transport: fixture.transport }),
    (data) => {
      output.push(data);
      return Promise.resolve();
    },
  );
  return { output, requests: fixture.requests };
}

describe("project runs CLI fixture mapping", () => {
  it("maps all 31 target operations through the SDK with exact wire bodies and headers", async () => {
    assertEquals(Object.keys(RUNS_COMMANDS).sort(), Object.keys(RUNS_OPERATIONS).sort());
    assertEquals(new Set(Object.values(RUNS_COMMANDS)).size, 31);
    for (const id of Object.keys(RUNS_COMMANDS) as RunsOperationId[]) {
      const { output, requests } = await execute(argv(id), [fixtureResponse(id)]);
      const fixture = RUNS_OPERATION_FIXTURES[id];
      assertEquals(requests.length, 1, id);
      const [request] = requests;
      assert(request);
      assertEquals(request.url, `https://api.example.test${fixture.url}`, id);
      assertEquals(request.method, RUNS_OPERATIONS[id].method, id);
      assertEquals(request.headers.get("Authorization"), "Bearer user-token", id);
      const input = fixture.input as { headers?: Record<string, string>; body?: unknown };
      for (const [header, value] of Object.entries(input.headers ?? {})) {
        assertEquals(request.headers.get(header), String(value), id);
      }
      assertEquals(
        await request.text(),
        input.body === undefined ? "" : JSON.stringify(input.body),
        id,
      );
      if (id === "streamRunEvents") {
        assert(output.length > 0);
      } else {
        assertEquals(output, [fixture.response.body ?? null], id);
      }
    }
  });

  it("forwards query types and follows pagination only with --all", async () => {
    const page = RUNS_OPERATION_FIXTURES.listRuns.response.body;
    const args = ["project", "runs", "list", "--query", '{"limit":2,"root_only":false}', "--all"];
    const { output, requests } = await execute(args, [
      Response.json({ ...page, page_info: { next: "next/page" } }),
      fixtureResponse("listRuns"),
    ]);
    assertEquals(output, [[...page.data, ...page.data]]);
    assert(requests[0]);
    assert(requests[1]);
    assertEquals(new URL(requests[0].url).searchParams.get("root_only"), "false");
    assertEquals(new URL(requests[1].url).searchParams.get("cursor"), "next/page");
    const single = await execute(args.slice(0, -1), [fixtureResponse("listRuns")]);
    assertEquals(single.output, [page]);
  });

  it("uses scoped execution credentials for runtime mutations", async () => {
    for (
      const id of [
        "finalizeRun",
        "createRunHeartbeat",
        "createRunEventToken",
        "appendRunEvents",
      ] as const
    ) {
      const { requests } = await execute(argv(id), [fixtureResponse(id)], "execution-token");
      assert(requests[0]);
      assertEquals(requests[0].headers.get("Authorization"), "Bearer execution-token");
    }
  });

  it("streams SDK frames and resumes after the supplied event ID", async () => {
    const { output, requests } = await execute([
      ...argv("streamRunEvents"),
      "--last-event-id",
      "cursor-7",
    ], [fixtureResponse("streamRunEvents")]);
    assert(requests[0]);
    assertEquals(requests[0].headers.get("Last-Event-ID"), "cursor-7");
    assert(output.length > 0);
    assertEquals((output[0] as { id: string }).id, "42");
  });

  it("follows an accepted remote run using the SDK stream", async () => {
    const { requests, output } = await execute([
      ...argv("createRun"),
      "--follow",
    ], [fixtureResponse("createRun"), fixtureResponse("streamRunEvents")]);
    assertEquals(requests.length, 2);
    assert(requests[1]);
    assertEquals(
      requests[1].url,
      `https://api.example.test/runs/${RUNS_OPERATION_FIXTURES.createRun.response.body.id}/stream`,
    );
    assert(output.length > 1);
  });

  it("forwards schedule creation unchanged instead of creating a CLI execution policy", async () => {
    const body = {
      project_id: "00000000-0000-4000-8000-000000000001",
      source: { type: "schedule", id: "22222222-2222-4222-8222-222222222222" },
    };
    const { requests } = await execute([
      "project",
      "runs",
      "create",
      "--idempotency-key",
      "schedule-request",
      "--body",
      JSON.stringify(body),
    ], [fixtureResponse("createRun")]);
    assert(requests[0]);
    assertEquals(JSON.parse(await requests[0].text()), body);
  });

  it("rejects a missing follow run ID before sending a stream request", async () => {
    const fixture = createFixtureTransport([Response.json({ status: "pending" })]);
    await assertRejects(
      () =>
        runProjectRuns(
          parseCliArgs([...argv("createRun"), "--follow"]),
          createRunsSdk({ transport: fixture.transport }),
          () => Promise.resolve(),
        ),
      Error,
      "does not include a run ID",
    );
    assertEquals(fixture.requests.length, 1);
  });

  it("accepts the router's global no-animation flag", async () => {
    const result = await execute([...argv("getRun"), "--no-animation"], [
      fixtureResponse("getRun"),
    ]);
    assertEquals(result.requests.length, 1);
  });

  it("rejects usage mistakes before any SDK request", async () => {
    for (
      const args of [
        ["project", "runs", "get"],
        ["project", "runs", "create", "--body", "{}"],
        ["project", "runs", "list", "--query", "[]"],
        ["project", "runs", "list", "--query", '{"limit":{}}'],
        ["project", "runs", "list", "--unknown"],
        ["project", "runs", "event-token", "--run-id", "r1", "--body", "{}"],
        ["project", "runs", "get", "--run-id", "r1", "--all"],
        ["project", "runs", "list", "--follow"],
        ["project", "runs", "stream", "--run-id", "r1", "--output", "frames.json"],
      ]
    ) {
      const fixture = createFixtureTransport([]);
      await assertRejects(() =>
        runProjectRuns(
          parseCliArgs(args),
          createRunsSdk({ transport: fixture.transport }),
          () => Promise.resolve(),
        )
      );
      assertEquals(fixture.requests.length, 0);
    }
  });
});
