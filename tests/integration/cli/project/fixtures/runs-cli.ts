import "#veryfront/schemas/_test-setup.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  fixtureResponse,
  RUNS_OPERATION_FIXTURES,
} from "#veryfront/runs/target/client.test-helpers.ts";
import { parseCliArgs } from "../../../../../cli/shared/args.ts";
import { setJsonMode } from "../../../../../cli/shared/json-output.ts";
import { handleProjectCommand } from "../../../../../cli/commands/project/handler.ts";

const [projectDir, scenario] = Deno.args;
if (!projectDir) throw new Error("A project directory is required.");

function commandFor(name: string | undefined): string[] {
  if (name?.startsWith("ndjson")) {
    return [
      "project",
      "runs",
      "list",
      "--ndjson",
      ...(name === "ndjson-all" ? ["--all"] : []),
      ...(name === "ndjson-json" ? ["--json"] : []),
      ...(name === "ndjson-invalid" ? ["--query", "[]"] : []),
    ];
  }
  if (name?.startsWith("stream")) return ["project", "runs", "stream", "--run-id", "r1"];
  if (name === "login-list") return ["project", "runs", "list"];
  if (name === "login-analytics") return ["project", "runs", "analytics"];
  const action = name === "event-token" ? "event-token" : "get";
  return ["project", "runs", action, "--run-id", "r1"];
}

function assertCredentialHeaders(init: RequestInit | undefined): void {
  const headers = new Headers(init?.headers);
  if (scenario === "api-key") {
    if (headers.get("X-API-Key") !== "scoped-test-token" || headers.has("Authorization")) {
      throw new Error("Incorrect API-key credential headers.");
    }
  } else if (headers.get("Authorization") !== "Bearer scoped-test-token") {
    throw new Error("Incorrect scoped credential.");
  }
}

const argv = commandFor(scenario);
argv.push("--project-dir", projectDir);
if (!scenario?.startsWith("ndjson")) argv.push("--json");
if (!scenario?.startsWith("login-")) argv.push("--credential-file", `${projectDir}/credential`);
if (scenario === "api-key") argv.push("--credential-mode", "api-key");
setJsonMode(!scenario?.startsWith("ndjson"));
let requests = 0;
await withMockFetch((_url, init) => {
  assertCredentialHeaders(init);
  requests++;
  if (scenario?.startsWith("ndjson")) {
    if (
      requests === 1 ||
      ["ndjson", "ndjson-all", "ndjson-json", "ndjson-output-closed"].includes(scenario ?? "")
    ) {
      return Promise.resolve(Response.json({
        ...RUNS_OPERATION_FIXTURES.listRuns.response.body,
        ...(["ndjson-error-blocked", "ndjson-output-closed"].includes(scenario ?? "")
          ? { data: [{ id: "first", payload: "x".repeat(1024 * 1024) }] }
          : {}),
        page_info: { next: requests === 1 ? "second" : null },
      }));
    }
    if (scenario === "ndjson-error-blocked") {
      console.error("ndjson-error-ready");
    }
    return Promise.resolve(Response.json({
      type: "about:blank",
      status: 403,
      title: "Rejected",
      code: "FORBIDDEN",
      detail: scenario === "ndjson-error-blocked" ? "Rejected. ".repeat(750) : "Rejected.",
    }, { status: 403 }));
  }
  if (scenario === "validation" || scenario === "forbidden") {
    const status = scenario === "validation" ? 422 : 403;
    return Promise.resolve(Response.json({
      type: "about:blank",
      status,
      title: "Rejected",
      code: scenario === "validation" ? "INVALID_REQUEST" : "FORBIDDEN",
      detail: "The request was rejected.",
    }, { status }));
  }
  if (scenario === "stream-network") {
    return Promise.reject(new TypeError("Fixture network failure"));
  }
  if (scenario === "stream-malformed") {
    return Promise.resolve(
      new Response(
        'id: 1\nevent: RUN_STARTED\ndata: {"event_id":1,"event_type":"RUN_STARTED","payload":{"type":"RUN_STARTED"},"is_error":false,"created_at":null}\n\ndata: not-json\n\n',
        {
          headers: { "Content-Type": "text/event-stream" },
        },
      ),
    );
  }
  if (scenario === "login-list") return Promise.resolve(fixtureResponse("listRuns"));
  if (scenario === "login-analytics") {
    return Promise.resolve(fixtureResponse("getAccountRunAnalytics"));
  }
  if (scenario === "event-token") return Promise.resolve(fixtureResponse("createRunEventToken"));
  if (scenario === "business-output") {
    return fixtureResponse("getRun").json().then((body) =>
      Response.json({ ...body, output: { token_count: 2, credential_policy: "minimum-length" } })
    );
  }
  return Promise.resolve(
    fixtureResponse(scenario?.startsWith("stream") ? "streamRunEvents" : "getRun"),
  );
}, () => handleProjectCommand(parseCliArgs(argv)));
