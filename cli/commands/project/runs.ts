import { API_CLIENT_ERROR, INVALID_ARGUMENT } from "veryfront/errors";
import type { ParsedArgs } from "#cli/shared/types";
import type {
  RunsCallOptions,
  RunsInput,
  RunsOperationId,
  RunsPaginatedOperationId,
  RunsSdk,
} from "veryfront/runs/target";
import { RUNS_OPERATIONS } from "veryfront/runs/target";

/** Public subcommands of the existing project family, one per target operation. */
export const RUNS_COMMANDS = {
  listRuns: "list",
  createRun: "create",
  getRun: "get",
  updateRun: "update",
  deleteRun: "delete",
  cancelRun: "cancel",
  resumeRun: "resume",
  listProjectRuns: "project-list",
  listConversationRuns: "conversation-list",
  getAccountRunAnalytics: "analytics",
  listRunEvents: "events",
  appendRunEvents: "append-events",
  getRunEvent: "event",
  getRunEventsSummary: "events-summary",
  getRunSnapshot: "snapshot",
  streamRunEvents: "stream",
  listRunEventTypes: "event-types",
  listRunInputRequests: "inputs",
  createRunInputRequest: "create-input",
  listConversationInputRequests: "conversation-inputs",
  listProjectWebhookRuns: "webhook-list",
  listEvalRuns: "eval-list",
  getInputRequest: "input",
  createInputResponse: "respond",
  cancelInputRequest: "cancel-input",
  pauseRun: "pause",
  finalizeRun: "finalize",
  succeedRun: "succeed",
  failRun: "fail",
  createRunHeartbeat: "heartbeat",
  createRunEventToken: "event-token",
  listRunChildRuns: "children",
  listConversationChildRuns: "conversation-children",
} as const satisfies Record<RunsOperationId, string>;

const PAGINATED = new Set<RunsPaginatedOperationId>([
  "listRuns",
  "listProjectRuns",
  "listConversationRuns",
  "listRunEvents",
  "listRunInputRequests",
  "listConversationInputRequests",
  "listProjectWebhookRuns",
  "listEvalRuns",
  "listRunChildRuns",
  "listConversationChildRuns",
]);
const IDEMPOTENT = new Set<RunsOperationId>([
  "createRun",
  "cancelRun",
  "resumeRun",
  "createRunInputRequest",
  "createInputResponse",
  "cancelInputRequest",
  "pauseRun",
  "finalizeRun",
  "succeedRun",
  "failRun",
]);
const BODY_REQUIRED = new Set<RunsOperationId>([
  "createRun",
  "updateRun",
  "resumeRun",
  "createRunInputRequest",
  "createInputResponse",
  "finalizeRun",
  "succeedRun",
  "failRun",
  "createRunHeartbeat",
]);
const BODY_OPTIONAL = new Set<RunsOperationId>(["appendRunEvents"]);
const QUERY_OPERATIONS = new Set<RunsOperationId>([
  ...PAGINATED,
  "getAccountRunAnalytics",
  "getRunEventsSummary",
]);

function usage(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function stringOption(args: ParsedArgs, name: string, required = false): string | undefined {
  const value = args[name];
  if (value === undefined && !required) return undefined;
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length === 0) {
    usage(`Supply --${name} with a value.`);
  }
  return String(value);
}

function jsonOption(args: ParsedArgs, name: string): unknown {
  const text = stringOption(args, name);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    usage(`Supply valid JSON for --${name}.`);
  }
}

const GLOBAL_OPTIONS = [
  "_",
  "__explicit",
  "json",
  "j",
  "help",
  "h",
  "quiet",
  "q",
  "verbose",
  "color",
  "no-color",
  "yes",
  "y",
  "output",
  "o",
  "no-input",
  "no-animation",
  "no-browser",
  "version",
  "v",
  "project-dir",
  "credential-file",
  "terminal-token-file",
  "credential-mode",
  "all",
  "ndjson",
  "follow",
  "query",
  "body",
  "idempotency-key",
  "if-match",
  "last-event-id",
  "accept-dispatch",
];

function resolveOperation(args: ParsedArgs): RunsOperationId {
  const action = args._[2];
  const entry = Object.entries(RUNS_COMMANDS).find(([, command]) => command === action);
  if (!entry || args._.length !== 3) {
    usage(
      `Use veryfront project runs <command>. Commands: ${Object.values(RUNS_COMMANDS).join(", ")}.`,
    );
  }
  return entry[0] as RunsOperationId;
}

function pathParameterNames(operationId: RunsOperationId): string[] {
  return [...RUNS_OPERATIONS[operationId].path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!)
    .filter(Boolean);
}

function assertKnownOptions(args: ParsedArgs, pathNames: string[]): void {
  const allowed = new Set([
    ...GLOBAL_OPTIONS,
    ...pathNames.map((name) => name.replaceAll("_", "-")),
  ]);
  for (const name of Object.keys(args)) {
    if (!allowed.has(name)) usage(`Unknown option --${name}.`);
  }
}

function parseHeaders(args: ParsedArgs, operationId: RunsOperationId): Record<string, string> {
  const headers: Record<string, string> = {};
  const idempotencyKey = stringOption(args, "idempotency-key", IDEMPOTENT.has(operationId));
  const ifMatch = stringOption(args, "if-match", operationId === "updateRun");
  if (idempotencyKey !== undefined) {
    if (!IDEMPOTENT.has(operationId)) usage("This command does not accept --idempotency-key.");
    headers["Idempotency-Key"] = idempotencyKey;
  }
  if (ifMatch !== undefined) {
    if (operationId !== "updateRun") usage("Only update accepts --if-match.");
    headers["If-Match"] = ifMatch;
  }
  if (args["accept-dispatch"] !== undefined) {
    if (operationId !== "createRunHeartbeat") usage("Only heartbeat accepts --accept-dispatch.");
    if (args["accept-dispatch"] !== true) usage("Use --accept-dispatch without a value.");
    headers["X-Veryfront-Run-Dispatch-Acceptance"] = "true";
  }
  return headers;
}

function parseBody(args: ParsedArgs, operationId: RunsOperationId): unknown {
  const body = jsonOption(args, "body");
  if (body === undefined && BODY_REQUIRED.has(operationId)) {
    usage("Supply --body with a JSON request.");
  }
  if (body !== undefined && !BODY_REQUIRED.has(operationId) && !BODY_OPTIONAL.has(operationId)) {
    usage("This command does not accept --body.");
  }
  return body;
}

function isQueryScalar(item: unknown): boolean {
  return item === null || ["string", "number", "boolean"].includes(typeof item);
}

function parseQuery(args: ParsedArgs, operationId: RunsOperationId): unknown {
  const query = jsonOption(args, "query");
  if (query === undefined) return undefined;
  if (!QUERY_OPERATIONS.has(operationId)) usage("This command does not accept --query.");
  if (query === null || typeof query !== "object" || Array.isArray(query)) {
    usage("Supply --query with a JSON object.");
  }
  for (const value of Object.values(query)) {
    if (![value].flat().every(isQueryScalar)) {
      usage("Query values must be strings, numbers, booleans, null, or arrays of those values.");
    }
  }
  return query;
}

function parseStreamOptions(
  args: ParsedArgs,
  operationId: RunsOperationId,
  headers: Record<string, string>,
) {
  for (const flag of ["all", "follow", "ndjson"]) {
    if (args[flag] !== undefined && typeof args[flag] !== "boolean") {
      usage(`--${flag} is a boolean flag.`);
    }
  }
  const ndjson = args.ndjson === true;
  const all = args.all === true || ndjson;
  const follow = args.follow === true;
  if (all && !PAGINATED.has(operationId as RunsPaginatedOperationId)) {
    usage("--all and --ndjson require a paginated list command.");
  }
  if (follow && !["getRun", "createRun"].includes(operationId)) {
    usage("--follow requires get or create.");
  }
  const stream = ndjson || follow || operationId === "streamRunEvents";
  const lastEventId = stringOption(args, "last-event-id");
  if (lastEventId !== undefined) {
    if (!(follow || operationId === "streamRunEvents")) {
      usage("--last-event-id requires stream or --follow.");
    }
    if (operationId === "streamRunEvents") headers["Last-Event-ID"] = lastEventId;
  }
  if (stream && (args.output !== undefined || args.o !== undefined)) {
    usage("Stream output uses stdout; --output is not supported.");
  }
  return { all, ndjson, follow, stream, lastEventId };
}

/** Decode CLI syntax only; the shared contract and service own request validation. */
export function parseRunsInvocation(args: ParsedArgs) {
  const operationId = resolveOperation(args);
  const names = pathParameterNames(operationId);
  assertKnownOptions(args, names);
  const path = Object.fromEntries(names.map((name) => [
    name,
    stringOption(args, name.replaceAll("_", "-"), true),
  ]));
  if (args["terminal-token-file"] !== undefined) {
    stringOption(args, "terminal-token-file", true);
    if (!["finalizeRun", "succeedRun", "failRun"].includes(operationId)) {
      usage("Only finalize, succeed and fail accept --terminal-token-file.");
    }
  }
  const headers = parseHeaders(args, operationId);
  const body = parseBody(args, operationId);
  const query = parseQuery(args, operationId);
  const streamOptions = parseStreamOptions(args, operationId, headers);
  return {
    operationId,
    input: {
      ...(names.length ? { path } : {}),
      ...(query === undefined ? {} : { query }),
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(body === undefined ? {} : { body }),
    },
    ...streamOptions,
  };
}

function runIdOf(result: unknown): string {
  const runId = result !== null && typeof result === "object" && "id" in result
    ? result.id
    : result !== null && typeof result === "object" && "run_id" in result
    ? result.run_id
    : undefined;
  if (typeof runId !== "string" || runId.length === 0) {
    throw API_CLIENT_ERROR.create({
      detail: "The run response does not include a run ID for --follow.",
      status: 502,
    });
  }
  return runId;
}

/** Execute only SDK calls and emit their results; no lifecycle or paging policy lives here. */
export async function runProjectRuns(
  args: ParsedArgs,
  sdk: RunsSdk,
  emit: (data: unknown) => Promise<void>,
  options: RunsCallOptions = {},
): Promise<void> {
  const { operationId, input, all, ndjson, follow, lastEventId } = parseRunsInvocation(args);
  if (operationId === "streamRunEvents") {
    for await (const frame of sdk.streamRunEvents(input as RunsInput<"streamRunEvents">)) {
      await emit(frame);
    }
    return;
  }
  if (all) {
    const items: unknown[] = [];
    for await (
      const item of sdk.paginate(operationId as RunsPaginatedOperationId, input as never, options)
    ) {
      options.signal?.throwIfAborted();
      if (ndjson) await emit(item);
      else items.push(item);
      options.signal?.throwIfAborted();
    }
    if (!ndjson) await emit(items);
    return;
  }
  // The dynamic command is checked against the operation registry above. Request shapes
  // are decoded at the CLI boundary; validation stays in the shared contract/service.
  const call = sdk[operationId] as (input: unknown) => Promise<unknown>;
  const result = await call(input);
  await emit(result ?? null);
  if (!follow) return;
  const followInput = {
    path: { run_id: runIdOf(result) },
    ...(lastEventId === undefined ? {} : { headers: { "Last-Event-ID": lastEventId } }),
  };
  for await (const frame of sdk.streamRunEvents(followInput)) await emit(frame);
}
