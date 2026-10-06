// Standalone AG-UI interoperability oracle.
// Run from the repository root with a Deno binary on PATH, or set AG_UI_ORACLE_DENO.
// Set AG_UI_ORACLE_NODE_MODULES to reuse an existing upstream install; otherwise this creates
// AG_UI_ORACLE_INSTALL_DIR, or a temp directory, and installs @ag-ui/core/client 1.0.2 there.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { agUiNegativeFixtures, agUiPositiveFixtures } from "./fixtures.mjs";

const UPSTREAM_PACKAGE_VERSION = "1.0.2";
const UPSTREAM_PROTOCOL_VERSION = "1.0";

function resolveDenoCommand() {
  return process.env.AG_UI_ORACLE_DENO ?? process.env.DENO_BIN ?? "deno";
}

function installOraclePackages(installDir) {
  mkdirSync(installDir, { recursive: true });
  const packageJsonPath = join(installDir, "package.json");
  try {
    writeFileSync(packageJsonPath, JSON.stringify({ private: true, type: "module" }) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const nodeDirectory = dirname(process.execPath);
  const npmCliCandidates = [
    join(nodeDirectory, "../lib/node_modules/npm/bin/npm-cli.js"),
    join(nodeDirectory, "node_modules/npm/bin/npm-cli.js"),
  ];
  const npmCli = npmCliCandidates.find((candidate) => existsSync(candidate));
  if (!npmCli) {
    throw new Error(
      "npm is missing beside Node; set AG_UI_ORACLE_NODE_MODULES to an existing install",
    );
  }
  execFileSync(
    process.execPath,
    [
      npmCli,
      "install",
      "--package-lock=false",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `@ag-ui/core@${UPSTREAM_PACKAGE_VERSION}`,
      `@ag-ui/client@${UPSTREAM_PACKAGE_VERSION}`,
    ],
    { cwd: installDir, stdio: "inherit" },
  );
}

function resolveOracleNodeModules() {
  if (process.env.AG_UI_ORACLE_NODE_MODULES) return process.env.AG_UI_ORACLE_NODE_MODULES;

  const installDir = process.env.AG_UI_ORACLE_INSTALL_DIR ??
    mkdtempSync(join(tmpdir(), "veryfront-ag-ui-oracle-"));
  if (!process.env.AG_UI_ORACLE_INSTALL_DIR) {
    process.once("exit", () => rmSync(installDir, { recursive: true, force: true }));
  }
  const nodeModules = join(installDir, "node_modules");
  if (
    !existsSync(join(nodeModules, "@ag-ui/core/package.json")) ||
    !existsSync(join(nodeModules, "@ag-ui/client/package.json"))
  ) {
    installOraclePackages(installDir);
  }
  return nodeModules;
}

const oracleNodeModules = resolveOracleNodeModules();
const require = createRequire(join(oracleNodeModules, ".ag-ui-oracle.cjs"));
const core = require(join(oracleNodeModules, "@ag-ui/core/dist/index.js"));
const schemas = require(join(oracleNodeModules, "@ag-ui/core/dist/schemas.js"));
const packageJson = require(join(oracleNodeModules, "@ag-ui/core/package.json"));
const clientPackageJson = require(join(oracleNodeModules, "@ag-ui/client/package.json"));
const client = require(join(oracleNodeModules, "@ag-ui/client/dist/index.js"));
const rxjs = require("rxjs");
const operators = require("rxjs/operators");

assert.equal(packageJson.version, UPSTREAM_PACKAGE_VERSION);
assert.equal(clientPackageJson.version, UPSTREAM_PACKAGE_VERSION);
assert.equal(packageJson.agui.protocolVersion, UPSTREAM_PROTOCOL_VERSION);
assert.equal(schemas.PROTOCOL_VERSION, UPSTREAM_PROTOCOL_VERSION);

function compareEventTypes(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
const upstreamEventTypes = Object.values(core.EventType).sort(compareEventTypes);
const fixtureTypes = [...new Set(agUiPositiveFixtures.map((event) => event.type))].sort(
  compareEventTypes,
);
assert.equal(upstreamEventTypes.length, 31);
assert.deepEqual(fixtureTypes, upstreamEventTypes);

for (const event of agUiPositiveFixtures) {
  const result = schemas.EventSchemas.safeParse(event);
  assert.equal(result.success, true, `${event.type} unexpectedly failed upstream validation`);
}

for (const fixture of agUiNegativeFixtures) {
  const result = schemas.EventSchemas.safeParse(fixture.event);
  assert.equal(result.success, false, `${fixture.id} unexpectedly passed upstream validation`);
}

const parityCorpus = [
  {
    id: "unknown-fields-preserved",
    event: { type: "TEXT_MESSAGE_START", messageId: "msg", extra: { nested: true } },
  },
  {
    id: "metadata-null-rejected",
    event: { type: "TEXT_MESSAGE_START", messageId: "msg", metadata: null },
  },
  {
    id: "fractional-timestamp-rejected",
    event: { type: "TEXT_MESSAGE_START", messageId: "msg", timestamp: 1.5 },
  },
  {
    id: "unsafe-timestamp-rejected",
    event: { type: "TEXT_MESSAGE_START", messageId: "msg", timestamp: Number.MAX_SAFE_INTEGER + 1 },
  },
  {
    id: "raw-event-null-rejected",
    event: { type: "RAW", event: { provider: "x" }, rawEvent: null },
  },
  {
    id: "subagent-run-id-null-rejected",
    event: { type: "TEXT_MESSAGE_CHUNK", subagentRunId: null },
  },
  {
    id: "text-start-optional-role-omitted",
    event: { type: "TEXT_MESSAGE_START", messageId: "msg" },
  },
  {
    id: "tool-result-optional-role-omitted",
    event: { type: "TOOL_CALL_RESULT", messageId: "tool-msg", toolCallId: "tool", content: "ok" },
  },
  {
    id: "text-chunk-context-fields-all-omitted",
    event: { type: "TEXT_MESSAGE_CHUNK" },
  },
  {
    id: "text-chunk-optional-delta-null-rejected",
    event: { type: "TEXT_MESSAGE_CHUNK", messageId: "msg", delta: null },
  },
  {
    id: "tool-chunk-context-fields-all-omitted",
    event: { type: "TOOL_CALL_CHUNK" },
  },
  {
    id: "tool-chunk-optional-name-null-rejected",
    event: { type: "TOOL_CALL_CHUNK", toolCallId: "tool", toolCallName: null },
  },
  {
    id: "reasoning-chunk-context-fields-all-omitted",
    event: { type: "REASONING_MESSAGE_CHUNK" },
  },
  {
    id: "reasoning-chunk-optional-message-id-null-rejected",
    event: { type: "REASONING_MESSAGE_CHUNK", messageId: null, delta: "r" },
  },
  {
    id: "run-input-defaults-and-null-state",
    event: {
      type: "RUN_STARTED",
      threadId: "thread",
      runId: "run",
      input: {
        threadId: "thread",
        runId: "run",
        state: null,
        messages: [{ id: "user", role: "user", content: [{ type: "text", text: "hi" }] }],
      },
    },
  },
  {
    id: "run-finished-success",
    event: { type: "RUN_FINISHED", threadId: "thread", runId: "run", outcome: { type: "success" } },
  },
  {
    id: "run-finished-interrupt",
    event: {
      type: "RUN_FINISHED",
      threadId: "thread",
      runId: "run",
      outcome: { type: "interrupt", interrupts: [{ id: "approval", reason: "approval" }] },
    },
  },
  {
    id: "run-finished-cancelled",
    event: {
      type: "RUN_FINISHED",
      threadId: "thread",
      runId: "run",
      outcome: { type: "cancelled" },
    },
  },
  {
    id: "json-patch-remove-extra-value",
    event: { type: "STATE_DELTA", delta: [{ op: "remove", path: "/a", value: "ignored" }] },
  },
  {
    id: "json-patch-add-nested-value",
    event: { type: "STATE_DELTA", delta: [{ op: "add", path: "/a/0", value: { nested: [1] } }] },
  },
  {
    id: "json-patch-move-from-pointer",
    event: { type: "STATE_DELTA", delta: [{ op: "move", from: "/a", path: "/b" }] },
  },
  {
    id: "json-patch-copy-bad-from-pointer",
    event: { type: "STATE_DELTA", delta: [{ op: "copy", from: "a", path: "/b" }] },
  },
  {
    id: "json-patch-test-null-value",
    event: { type: "STATE_DELTA", delta: [{ op: "test", path: "/a", value: null }] },
  },
  {
    id: "json-patch-add-missing-value-rejected",
    event: { type: "STATE_DELTA", delta: [{ op: "add", path: "/a" }] },
  },
  {
    id: "json-patch-bad-pointer",
    event: { type: "STATE_DELTA", delta: [{ op: "replace", path: "a", value: 1 }] },
  },
  {
    id: "nested-message-content",
    event: {
      type: "MESSAGES_SNAPSHOT",
      messages: [
        {
          id: "user",
          role: "user",
          content: [
            { type: "text", text: "inspect" },
            { type: "document", source: { type: "data", value: "abc", mimeType: "text/plain" } },
          ],
        },
      ],
    },
  },
];

function jsonBoundary(value) {
  return JSON.parse(JSON.stringify(value));
}

function upstreamParse(events) {
  return events.map(({ id, event }) => {
    const result = schemas.EventSchemas.safeParse(event);
    return result.success
      ? { id, success: true, data: jsonBoundary(result.data) }
      : { id, success: false };
  });
}

function localParse(events) {
  const script = `
import "#veryfront/schemas/_test-setup.ts";
import "./src/events/test-setup.ts";
import { safeParseAgUiEvent } from "./src/events/ag-ui/index.ts";
const input = JSON.parse(await new Response(Deno.stdin.readable).text());
const output = input.map(({ id, event }) => {
  const result = safeParseAgUiEvent(event);
  return result.success ? { id, success: true, data: result.data } : { id, success: false };
});
console.log("__RESULT__" + JSON.stringify(output));
`;
  const stdout = execFileSync(
    resolveDenoCommand(),
    ["eval", "--config=deno.json", "--no-check", script],
    {
      cwd: process.cwd(),
      input: JSON.stringify(events),
      encoding: "utf8",
    },
  );
  const resultLine = stdout.trim().split(/\r?\n/).find((line) => line.startsWith("__RESULT__"));
  assert.ok(resultLine, "local parser subprocess did not return a result marker");
  return JSON.parse(resultLine.slice("__RESULT__".length));
}

assert.deepEqual(localParse(parityCorpus), upstreamParse(parityCorpus));

function localDirectNullStateDetails(event) {
  const script = `
import "#veryfront/schemas/_test-setup.ts";
import "./src/events/test-setup.ts";
import { safeParseAgUiEvent } from "./src/events/ag-ui/index.ts";
const event = JSON.parse(await new Response(Deno.stdin.readable).text());
const result = safeParseAgUiEvent(event);
if (!result.success) {
  console.log("__RESULT__" + JSON.stringify({ success: false }));
} else {
  const input = result.data.input;
  console.log("__RESULT__" + JSON.stringify({
    success: true,
    hasOwnState: Object.hasOwn(input, "state"),
    stateIsUndefined: input.state === undefined,
    tools: input.tools,
    context: input.context,
  }));
}
`;
  const stdout = execFileSync(
    resolveDenoCommand(),
    ["eval", "--config=deno.json", "--no-check", script],
    {
      cwd: process.cwd(),
      input: JSON.stringify(event),
      encoding: "utf8",
    },
  );
  const resultLine = stdout.trim().split(/\r?\n/).find((line) => line.startsWith("__RESULT__"));
  assert.ok(resultLine, "local direct parser subprocess did not return a result marker");
  return JSON.parse(resultLine.slice("__RESULT__".length));
}

const directRunStartedNullState = {
  type: "RUN_STARTED",
  threadId: "thread",
  runId: "run",
  input: {
    threadId: "thread",
    runId: "run",
    state: null,
    messages: [],
  },
};
const upstreamDirectNullState = schemas.EventSchemas.safeParse(directRunStartedNullState);
assert.equal(upstreamDirectNullState.success, true, "upstream direct null-state parse failed");
const directNullStateLocal = localDirectNullStateDetails(directRunStartedNullState);
assert.equal(directNullStateLocal.success, true, "local direct null-state parse failed");
assert.equal(
  Object.hasOwn(upstreamDirectNullState.data.input, "state"),
  true,
  "upstream keeps state as an own key",
);
assert.equal(
  directNullStateLocal.hasOwnState,
  false,
  "local parser drops null state as a normalized default",
);
assert.equal(upstreamDirectNullState.data.input.state, undefined);
assert.equal(directNullStateLocal.stateIsUndefined, true);
assert.deepEqual(upstreamDirectNullState.data.input.tools, directNullStateLocal.tools);
assert.deepEqual(upstreamDirectNullState.data.input.context, directNullStateLocal.context);

function localTransform(events) {
  const script = `
import "#veryfront/schemas/_test-setup.ts";
import "./src/events/test-setup.ts";
import { acceptAgUiEvent } from "./src/events/ag-ui/index.ts";
const events = JSON.parse(await new Response(Deno.stdin.readable).text());
let normalizationState;
const output = [];
events.forEach((event, index) => {
  const result = acceptAgUiEvent({
    event,
    producerOccurrence: { source: "oracle", id: String(index) },
    normalizationState,
  });
  normalizationState = result.normalizationState;
  for (const command of result.commands) {
    if (command.kind === "expanded-ag-ui-event") output.push(command.event);
  }
  if (!String(event.type).endsWith("_CHUNK")) output.push(result.accepted.event);
});
console.log("__RESULT__" + JSON.stringify(output));
`;
  const stdout = execFileSync(
    resolveDenoCommand(),
    ["eval", "--config=deno.json", "--no-check", script],
    {
      cwd: process.cwd(),
      input: JSON.stringify(events),
      encoding: "utf8",
    },
  );
  const resultLine = stdout.trim().split(/\r?\n/).find((line) => line.startsWith("__RESULT__"));
  assert.ok(resultLine, "local transform subprocess did not return a result marker");
  return JSON.parse(resultLine.slice("__RESULT__".length));
}

async function upstreamChunkTransform(events) {
  return await rxjs.lastValueFrom(
    client.transformChunks()(rxjs.of(...events)).pipe(operators.toArray()),
  );
}

const chunkSequences = [
  {
    id: "successive-text-omitted-id",
    input: [
      { type: "TEXT_MESSAGE_CHUNK", messageId: "msg-1", delta: "hel" },
      { type: "TEXT_MESSAGE_CHUNK", delta: "lo" },
      { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
    ],
    expanded: [
      { type: "TEXT_MESSAGE_START", messageId: "msg-1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "msg-1", delta: "hel" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "msg-1", delta: "lo" },
      { type: "TEXT_MESSAGE_END", messageId: "msg-1" },
      { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
    ],
  },
  {
    id: "interleaved-subagent-lanes",
    input: [
      { type: "TEXT_MESSAGE_CHUNK", subagentRunId: "sub-a", messageId: "a", delta: "a1" },
      { type: "TEXT_MESSAGE_CHUNK", subagentRunId: "sub-b", messageId: "b", delta: "b1" },
      { type: "TEXT_MESSAGE_CHUNK", subagentRunId: "sub-a", delta: "a2" },
      { type: "TEXT_MESSAGE_CHUNK", subagentRunId: "sub-b", delta: "b2" },
      { type: "RUN_ERROR", message: "stop" },
    ],
    expanded: [
      { type: "TEXT_MESSAGE_START", messageId: "a", role: "assistant", subagentRunId: "sub-a" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "a1", subagentRunId: "sub-a" },
      { type: "TEXT_MESSAGE_START", messageId: "b", role: "assistant", subagentRunId: "sub-b" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "b", delta: "b1", subagentRunId: "sub-b" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "a2", subagentRunId: "sub-a" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "b", delta: "b2", subagentRunId: "sub-b" },
      { type: "TEXT_MESSAGE_END", messageId: "a", subagentRunId: "sub-a" },
      { type: "TEXT_MESSAGE_END", messageId: "b", subagentRunId: "sub-b" },
      { type: "RUN_ERROR", message: "stop" },
    ],
  },
  {
    id: "reasoning-then-tool-same-lane",
    input: [
      { type: "REASONING_MESSAGE_CHUNK", messageId: "reason-1", delta: "r1" },
      { type: "REASONING_MESSAGE_CHUNK", delta: "r2" },
      { type: "TOOL_CALL_CHUNK", toolCallId: "tool-1", toolCallName: "lookup", delta: '{"a"' },
      { type: "TOOL_CALL_CHUNK", delta: ":1}" },
      { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
    ],
    expanded: [
      { type: "REASONING_MESSAGE_START", messageId: "reason-1", role: "reasoning" },
      { type: "REASONING_MESSAGE_CONTENT", messageId: "reason-1", delta: "r1" },
      { type: "REASONING_MESSAGE_CONTENT", messageId: "reason-1", delta: "r2" },
      { type: "REASONING_MESSAGE_END", messageId: "reason-1" },
      { type: "TOOL_CALL_START", toolCallId: "tool-1", toolCallName: "lookup" },
      { type: "TOOL_CALL_ARGS", toolCallId: "tool-1", delta: '{"a"' },
      { type: "TOOL_CALL_ARGS", toolCallId: "tool-1", delta: ":1}" },
      { type: "TOOL_CALL_END", toolCallId: "tool-1" },
      { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
    ],
  },
  {
    id: "step-finished-closes-parent-lane",
    input: [
      { type: "TEXT_MESSAGE_CHUNK", messageId: "msg-step", delta: "before" },
      { type: "STEP_FINISHED", stepName: "plan" },
      { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
    ],
    expanded: [
      { type: "TEXT_MESSAGE_START", messageId: "msg-step", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "msg-step", delta: "before" },
      { type: "TEXT_MESSAGE_END", messageId: "msg-step" },
      { type: "STEP_FINISHED", stepName: "plan" },
      { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
    ],
  },
  {
    id: "subagent-finished-closes-subagent-lane",
    input: [
      { type: "TEXT_MESSAGE_CHUNK", subagentRunId: "sub-1", messageId: "msg-sub", delta: "before" },
      { type: "SUBAGENT_FINISHED", subagentRunId: "sub-1" },
      { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
    ],
    expanded: [
      {
        type: "TEXT_MESSAGE_START",
        messageId: "msg-sub",
        role: "assistant",
        subagentRunId: "sub-1",
      },
      {
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "msg-sub",
        delta: "before",
        subagentRunId: "sub-1",
      },
      { type: "TEXT_MESSAGE_END", messageId: "msg-sub", subagentRunId: "sub-1" },
      { type: "SUBAGENT_FINISHED", subagentRunId: "sub-1" },
      { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
    ],
  },
  {
    id: "chunk-metadata-raw-event-extension-propagation",
    input: [
      {
        type: "TEXT_MESSAGE_CHUNK",
        messageId: "msg-meta",
        delta: "body",
        timestamp: 42,
        metadata: { trace: "m" },
        rawEvent: { provider: "p" },
        extension: { nested: true },
      },
      {
        type: "TOOL_CALL_CHUNK",
        toolCallId: "tool-meta",
        toolCallName: "lookup",
        metadata: { trace: "tool" },
        extension: "args",
      },
      {
        type: "REASONING_MESSAGE_CHUNK",
        messageId: "reason-meta",
        metadata: { trace: "reason" },
        extension: "reason",
      },
      { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
    ],
    expanded: [
      {
        type: "TEXT_MESSAGE_START",
        messageId: "msg-meta",
        role: "assistant",
        metadata: { trace: "m" },
      },
      {
        extension: { nested: true },
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "msg-meta",
        delta: "body",
        metadata: { trace: "m" },
        rawEvent: { provider: "p" },
      },
      { type: "TEXT_MESSAGE_END", messageId: "msg-meta" },
      {
        extension: "args",
        type: "TOOL_CALL_START",
        toolCallId: "tool-meta",
        toolCallName: "lookup",
        metadata: { trace: "tool" },
      },
      { type: "TOOL_CALL_END", toolCallId: "tool-meta" },
      {
        extension: "reason",
        type: "REASONING_MESSAGE_START",
        messageId: "reason-meta",
        role: "reasoning",
        metadata: { trace: "reason" },
      },
      { type: "REASONING_MESSAGE_END", messageId: "reason-meta" },
      { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
    ],
    localExpanded: [
      {
        type: "TEXT_MESSAGE_START",
        messageId: "msg-meta",
        role: "assistant",
        timestamp: 42,
        metadata: { trace: "m" },
      },
      {
        extension: { nested: true },
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "msg-meta",
        delta: "body",
        timestamp: 42,
        metadata: { trace: "m" },
        rawEvent: { provider: "p" },
      },
      { type: "TEXT_MESSAGE_END", messageId: "msg-meta" },
      {
        extension: "args",
        type: "TOOL_CALL_START",
        toolCallId: "tool-meta",
        toolCallName: "lookup",
        metadata: { trace: "tool" },
      },
      { type: "TOOL_CALL_END", toolCallId: "tool-meta" },
      {
        extension: "reason",
        type: "REASONING_MESSAGE_START",
        messageId: "reason-meta",
        role: "reasoning",
        metadata: { trace: "reason" },
      },
      { type: "REASONING_MESSAGE_END", messageId: "reason-meta" },
      { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
    ],
  },
];

for (const sequence of chunkSequences) {
  const expanded = await upstreamChunkTransform(sequence.input);
  assert.deepEqual(expanded, sequence.expanded, sequence.id);
  const expectedLocalExpanded = sequence.localExpanded ?? expanded;
  assert.deepEqual(
    localTransform(sequence.input),
    expectedLocalExpanded,
    `${sequence.id} local transform`,
  );
  for (const event of expanded) {
    assert.equal(
      schemas.EventSchemas.safeParse(event).success,
      true,
      `${sequence.id} emitted invalid ${event.type}`,
    );
  }
}

console.log("AG-UI upstream oracle and local parser parity checks passed.");
