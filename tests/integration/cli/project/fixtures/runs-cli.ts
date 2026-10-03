import "#veryfront/schemas/_test-setup.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { fixtureResponse } from "#veryfront/runs/target/client.test-helpers.ts";
import { parseCliArgs } from "../../../../../cli/shared/args.ts";
import { setJsonMode } from "../../../../../cli/shared/json-output.ts";
import { handleProjectCommand } from "../../../../../cli/commands/project/handler.ts";

const [projectDir, scenario] = Deno.args;
if (!projectDir) throw new Error("A project directory is required.");
const argv = scenario === "stream"
  ? ["project", "runs", "stream", "--run-id", "r1"]
  : ["project", "runs", "get", "--run-id", "r1"];
argv.push("--json", "--project-dir", projectDir, "--credential-file", `${projectDir}/credential`);
if (scenario === "api-key") argv.push("--credential-mode", "api-key");
setJsonMode(true);
await withMockFetch((_url, init) => {
  const headers = new Headers(init?.headers);
  if (scenario === "api-key") {
    if (headers.get("X-API-Key") !== "scoped-test-token" || headers.has("Authorization")) {
      throw new Error("Incorrect API-key credential headers.");
    }
  } else if (headers.get("Authorization") !== "Bearer scoped-test-token") {
    throw new Error("Incorrect scoped credential.");
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
  return Promise.resolve(fixtureResponse(scenario === "stream" ? "streamRunEvents" : "getRun"));
}, () => handleProjectCommand(parseCliArgs(argv)));
