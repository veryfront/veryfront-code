#!/usr/bin/env bash
# Clean-room install/import smoke for the generated npm packages.
#
# Verifies, against the real `deno task build:npm` artifacts installed into a
# throwaway npm project, that:
#   1. a `veryfront` install with co-published required packages runs the CLI
#      and activates the parser extension under Node
#   2. the @huggingface/transformers optional peer is declared
#   3. loading a missing extension fails naming the installable package
#   4. installing @veryfront/ext-auth-jwt makes the extension load
#   5. a broken transitive dependency surfaces the real error, not a
#      misleading "extension not installed" skip
#   6. `veryfront/scaffold` resolves by its published subpath and materializes
#      a project, so a hosted "create project" flow never has to walk into the
#      package's build output to reach the starter templates
#   7. the packed ai-agent starter starts under Node, renders a page, and loads
#      an API route without unresolved or runtime-specific generated helpers
#   8. a packed agent workflow reaches a non-responsive provider, respects its
#      configured deadline, persists failure, and leaves the server healthy
#
# Requires: `deno task build:npm` output in ./npm, node + npm + curl on PATH.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORKDIR="$(mktemp -d)"
DEV_PID=""

stop_dev_server() {
  [ -n "$DEV_PID" ] || return 0

  if kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null || true
    for _attempt in $(seq 1 50); do
      kill -0 "$DEV_PID" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 "$DEV_PID" 2>/dev/null || true
  fi

  wait "$DEV_PID" 2>/dev/null || true
  DEV_PID=""
}

cleanup() {
  stop_dev_server
  rm -rf "$WORKDIR"
}

trap cleanup EXIT

SMOKE_FAILURE_STATUS=1

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit "$SMOKE_FAILURE_STATUS"
}

fail_registry_install() {
  echo "SMOKE FAIL: exact-version registry install failed" >&2
  exit 20
}

REGISTRY_INSTALL_SPECS=()
REGISTRY_AUTH_SPEC=""
REGISTRY_URL=""

if [ -n "${VF_NPM_REGISTRY_VERSION:-}" ]; then
  SMOKE_FAILURE_STATUS=22
  [ -n "${VF_NPM_REGISTRY_PACKAGES:-}" ] || fail "registry package list is required in registry mode"
  REGISTRY_URL="${VF_NPM_REGISTRY_URL:-https://registry.npmjs.org}"
  case "$REGISTRY_URL" in
    *"?"* | *"#"*) fail "registry URL must not include a query or fragment" ;;
    http://* | https://*) ;;
    *) fail "registry URL must use HTTP or HTTPS" ;;
  esac
  REGISTRY_AUTHORITY="${REGISTRY_URL#*://}"
  REGISTRY_AUTHORITY="${REGISTRY_AUTHORITY%%/*}"
  case "$REGISTRY_AUTHORITY" in
    "" | *"@"*) fail "registry URL authority is invalid" ;;
  esac

  while IFS= read -r PACKAGE_NAME; do
    [ -n "$PACKAGE_NAME" ] || continue
    [[ "${#PACKAGE_NAME}" -le 214 && "$PACKAGE_NAME" =~ ^(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$ ]] ||
      fail "registry package list contains an invalid package name"
    PACKAGE_SPEC="${PACKAGE_NAME}@${VF_NPM_REGISTRY_VERSION}"
    if [ "$PACKAGE_NAME" = "@veryfront/ext-auth-jwt" ]; then
      REGISTRY_AUTH_SPEC="$PACKAGE_SPEC"
    else
      REGISTRY_INSTALL_SPECS+=("$PACKAGE_SPEC")
    fi
  done <<<"$VF_NPM_REGISTRY_PACKAGES"

  [ "${#REGISTRY_INSTALL_SPECS[@]}" -gt 0 ] || fail "registry package list has no root install packages"
  [ -n "$REGISTRY_AUTH_SPEC" ] || fail "registry package list is missing @veryfront/ext-auth-jwt"
else
  if [ -n "${VF_NPM_PACK_DIR:-}" ]; then
    [ -d "$VF_NPM_PACK_DIR" ] || fail "canonical npm artifact directory missing"
    deno run --config="$ROOT_DIR/scripts/test.deno.json" --allow-read --allow-run=tar \
      "$ROOT_DIR/scripts/ci/npm-compatibility-artifact.ts" verify "$VF_NPM_PACK_DIR" ||
      fail "canonical npm artifact verification failed"
    cp "$VF_NPM_PACK_DIR"/*.tgz "$WORKDIR"/
  else
    [ -d "$ROOT_DIR/npm" ] || fail "npm build output missing; run 'deno task build:npm' first"
    [ -d "$ROOT_DIR/npm/extensions/ext-bundler-esbuild" ] || fail "ext-bundler-esbuild package output missing"
    [ -d "$ROOT_DIR/npm/extensions/ext-content-mdx" ] || fail "ext-content-mdx package output missing"
    [ -d "$ROOT_DIR/npm/extensions/ext-css-tailwind" ] || fail "ext-css-tailwind package output missing"
    [ -d "$ROOT_DIR/npm/extensions/ext-dev-ui-react" ] || fail "ext-dev-ui-react package output missing"
    [ -d "$ROOT_DIR/npm/extensions/ext-node-websocket-ws" ] || fail "ext-node-websocket-ws package output missing"
    [ -d "$ROOT_DIR/npm/extensions/ext-parser-babel" ] || fail "ext-parser-babel package output missing"
    [ -d "$ROOT_DIR/npm/extensions/ext-yaml" ] || fail "ext-yaml package output missing"
    [ -d "$ROOT_DIR/npm/extensions/ext-auth-jwt" ] || fail "ext-auth-jwt package output missing"

    (cd "$ROOT_DIR/npm" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
    (cd "$ROOT_DIR/npm/extensions/ext-bundler-esbuild" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
    (cd "$ROOT_DIR/npm/extensions/ext-content-mdx" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
    (cd "$ROOT_DIR/npm/extensions/ext-css-tailwind" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
    (cd "$ROOT_DIR/npm/extensions/ext-dev-ui-react" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
    (cd "$ROOT_DIR/npm/extensions/ext-node-websocket-ws" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
    (cd "$ROOT_DIR/npm/extensions/ext-parser-babel" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
    (cd "$ROOT_DIR/npm/extensions/ext-yaml" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
    (cd "$ROOT_DIR/npm/extensions/ext-auth-jwt" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
  fi
fi

if [ -n "${VF_NPM_REGISTRY_VERSION:-}" ]; then
  SMOKE_FAILURE_STATUS=21
fi

cd "$WORKDIR"
npm init -y >/dev/null 2>&1
npm pkg set type=module >/dev/null
if [ -n "${VF_NPM_REGISTRY_VERSION:-}" ]; then
  NPM_CONFIG_REGISTRY="$REGISTRY_URL" npm install --no-fund --no-audit --silent --ignore-scripts "${REGISTRY_INSTALL_SPECS[@]}" ||
    fail_registry_install
else
  npm install --no-fund --no-audit --silent --ignore-scripts ./veryfront-[0-9]*.tgz ./veryfront-ext-bundler-esbuild-*.tgz ./veryfront-ext-content-mdx-*.tgz ./veryfront-ext-css-tailwind-*.tgz ./veryfront-ext-dev-ui-react-*.tgz ./veryfront-ext-node-websocket-ws-*.tgz ./veryfront-ext-parser-babel-*.tgz ./veryfront-ext-yaml-*.tgz
fi

echo "== 1. root install: CLI and deferred parser extension run under Node"
node node_modules/veryfront/bin/veryfront.js --version | grep -q "Veryfront CLI" ||
  fail "CLI --version failed on root install"
node node_modules/veryfront/bin/veryfront.js schema --json >/dev/null ||
  fail "CLI schema --json failed on root install (bundled ext-schema-zod broken)"
node -e "
const p = require('./node_modules/veryfront/package.json');
if (p.dependencies?.['@veryfront/ext-parser-babel'] !== p.version) process.exit(1);
if (p.dependencies?.['@veryfront/ext-dev-ui-react'] !== p.version) process.exit(1);
if (p.dependencies?.['@veryfront/ext-yaml'] !== p.version) process.exit(1);
if (p.dependencies?.['@veryfront/ext-node-websocket-ws'] !== p.version) process.exit(1);
" || fail "root package does not pin standard extensions to its version"
node --input-type=module -e "
const m = await import('./node_modules/veryfront/esm/src/extensions/builtin-extensions.js');
const { getDeferredExtensionState } = await import(
  './node_modules/veryfront/esm/src/extensions/deferred-extension.js'
);
const resolved = m.createDeferredBuiltinExtension({
  name: 'ext-parser-babel',
  origin: 'veryfront/ext-parser-babel',
  sourceDirectory: 'ext-parser-babel',
  availability: 'package',
  contracts: { provides: ['CodeParser'] },
  capabilities: [],
});
let codeParser;
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const deferred = getDeferredExtensionState(resolved);
if (!deferred) throw new Error('Parser extension was not deferred');
const extension = await deferred.load(logger);
if (!extension) throw new Error('Parser extension failed to load');
await extension.setup?.({
  get() {},
  require() { throw new Error('unexpected contract requirement'); },
  provide(name, impl) { if (name === 'CodeParser') codeParser = impl; },
  config: {},
  logger,
});
if (!codeParser) throw new Error('CodeParser was not registered');
const ast = await codeParser.parse({
  code: 'export default function Page(): JSX.Element { return <main />; }',
  filePath: 'app/page.tsx',
});
if (ast?.type !== 'File') throw new Error('TSX parse failed');
await extension.teardown?.();
" || fail "root deferred builtin did not register a working CodeParser"

echo "== 2. root install: transformers optional peer declared"
node -e "
const p = require('./node_modules/veryfront/package.json');
if (!p.peerDependencies?.['@huggingface/transformers']) process.exit(1);
if (p.peerDependenciesMeta?.['@huggingface/transformers']?.optional !== true) process.exit(1);
" || fail "@huggingface/transformers optional peer missing from root package.json"

echo "== 3. root install: missing extension failure names the installable package"
set +e
MISSING_OUTPUT="$(node -e "
import('./node_modules/veryfront/esm/src/extensions/first-party-import.js').then(async (m) => {
  await m.importFirstPartyExtensionModule('ext-auth-jwt', '@veryfront/ext-auth-jwt');
  console.log('UNEXPECTEDLY_LOADED');
}).catch((e) => { console.error(e.message); process.exit(1); });
" 2>&1)"
MISSING_STATUS=$?
set -e
[ "$MISSING_STATUS" -ne 0 ] || fail "ext-auth-jwt import unexpectedly succeeded on bare install"
echo "$MISSING_OUTPUT" | grep -q "install @veryfront/ext-auth-jwt alongside veryfront" ||
  fail "missing-extension error lacks the install hint: $MISSING_OUTPUT"

echo "== 4. with @veryfront/ext-auth-jwt installed: extension loads"
if [ -n "${VF_NPM_REGISTRY_VERSION:-}" ]; then
  NPM_CONFIG_REGISTRY="$REGISTRY_URL" npm install --no-fund --no-audit --silent --ignore-scripts "$REGISTRY_AUTH_SPEC" ||
    fail_registry_install
else
  npm install --no-fund --no-audit --silent --ignore-scripts ./veryfront-ext-auth-jwt-*.tgz
fi
node -e "
import('./node_modules/veryfront/esm/src/extensions/first-party-import.js').then(async (m) => {
  const mod = await m.importFirstPartyExtensionModule('ext-auth-jwt', '@veryfront/ext-auth-jwt');
  if (typeof mod.createAuthProvider !== 'function') process.exit(1);
});
" || fail "ext-auth-jwt did not load after installing @veryfront/ext-auth-jwt"

echo "== 5. broken transitive dependency surfaces the real error"
mv node_modules/jose node_modules/jose.smoke-removed
set +e
BROKEN_OUTPUT="$(node -e "
import('./node_modules/veryfront/esm/src/extensions/first-party-import.js').then(async (m) => {
  await m.importFirstPartyExtensionModule('ext-auth-jwt', '@veryfront/ext-auth-jwt');
  console.log('UNEXPECTEDLY_LOADED');
}).catch((e) => { console.error(e.message); process.exit(1); });
" 2>&1)"
BROKEN_STATUS=$?
set -e
mv node_modules/jose.smoke-removed node_modules/jose
[ "$BROKEN_STATUS" -ne 0 ] || fail "ext-auth-jwt import unexpectedly succeeded with jose removed"
echo "$BROKEN_OUTPUT" | grep -q "jose" ||
  fail "broken transitive dependency error does not name the real missing package: $BROKEN_OUTPUT"
echo "$BROKEN_OUTPUT" | grep -q "install @veryfront/ext-auth-jwt alongside veryfront" &&
  fail "broken transitive dependency was misclassified as a missing extension: $BROKEN_OUTPUT"

echo "== 6. scaffold resolves through the published exports map"
# Deliberately a bare specifier, resolved by Node against the package's own
# `exports`. The deep `./node_modules/veryfront/esm/...` paths used above
# bypass that map, so only this proves the subpath is actually exported —
# the failure a hosted create-project flow would hit, and the one this
# repository's in-tree tests cannot see because they all import by relative
# path. Without the entry it fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
node --input-type=module -e "
const { materializeScaffold, listScaffoldTemplates } = await import('veryfront/scaffold');
const { mkdir, writeFile } = await import('node:fs/promises');
const { dirname, resolve, sep } = await import('node:path');
const names = listScaffoldTemplates();
for (const name of ['minimal', 'ai-agent', 'agentic-workflow']) {
  if (!names.includes(name)) throw new Error('scaffold cannot create ' + name);
}
const { files } = await materializeScaffold({
  template: 'ai-agent',
  projectName: 'smoke-app',
});
const paths = files.map((file) => file.path);
for (const required of ['package.json', 'AGENTS.md', '.gitignore']) {
  if (!paths.includes(required)) {
    throw new Error('materialized project is missing ' + required);
  }
}
const pkg = JSON.parse(files.find((file) => file.path === 'package.json').content);
if (pkg.name !== 'smoke-app') {
  throw new Error('materialized package.json has the wrong name: ' + pkg.name);
}
const projectRoot = resolve('.');
for (const file of files) {
  const target = resolve(projectRoot, file.path);
  if (!target.startsWith(projectRoot + sep)) {
    throw new Error('materialized project contains an invalid path: ' + file.path);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.content);
}
" || fail "veryfront/scaffold did not resolve from an installed package"

echo "== 7. published ai-agent starter: page and API route render over HTTP"
mkdir -p "$WORKDIR/app/api/npm-smoke"
cat >"$WORKDIR/app/api/npm-smoke/route.ts" <<'EOF'
export function GET(): Response {
  return Response.json({ ok: true });
}
EOF
mkdir -p \
  "$WORKDIR/app/api/npm-black-hole/messages" \
  "$WORKDIR/app/api/workflows/[...path]" \
  "$WORKDIR/agents" \
  "$WORKDIR/lib" \
  "$WORKDIR/workflows"
cat >"$WORKDIR/app/api/npm-black-hole/messages/route.ts" <<'EOF'
export async function POST(request: Request): Promise<Response> {
  const body = await request.json() as { model?: unknown };
  const url = new URL(request.url);
  if (
    url.pathname !== "/api/npm-black-hole/messages" ||
    request.headers.get("x-api-key") !== "npm-smoke-key" ||
    body.model !== "claude-haiku-4-5-20251001"
  ) {
    return Response.json({ error: "unexpected Anthropic request" }, { status: 400 });
  }
  console.log("NPM_SMOKE_BLACK_HOLE_RECEIVED");
  return await new Promise<Response>(() => {});
}
EOF
cat >"$WORKDIR/agents/timeout-smoke.ts" <<'EOF'
import { agent } from "veryfront/agent";

export default agent({
  id: "timeout-smoke",
  model: "anthropic/claude-haiku-4-5-20251001",
  system: "Reply with OK.",
  maxSteps: 1,
});
EOF
cat >"$WORKDIR/workflows/timeout-smoke.ts" <<'EOF'
import { agentStep, workflow } from "veryfront/workflow";
import { defineSchema } from "veryfront/schemas";

export default workflow({
  id: "timeout-smoke",
  inputSchema: defineSchema((v) => v.object({ message: v.string() }))(),
  steps: [
    agentStep("call-provider", "timeout-smoke", {
      input: (context) => (context.input as { message: string }).message,
      timeout: "2s",
    }),
  ],
});
EOF
cat >"$WORKDIR/lib/workflows.ts" <<'EOF'
import { getAgent, getAllAgentIds } from "veryfront/agent";
import { toolRegistry } from "veryfront/tool";
import { createWorkflowClient, type Workflow } from "veryfront/workflow";
import timeoutSmoke from "../workflows/timeout-smoke.ts";

const globalScope = globalThis as typeof globalThis & {
  npmSmokeWorkflowClient?: ReturnType<typeof createWorkflowClient>;
};

export const workflows = globalScope.npmSmokeWorkflowClient ??= createWorkflowClient({
  executor: {
    stepExecutor: {
      agentRegistry: { get: getAgent, list: getAllAgentIds },
      toolRegistry,
    },
  },
});

workflows.register(timeoutSmoke as Workflow<unknown, unknown>);
EOF
cat >"$WORKDIR/app/api/workflows/[...path]/route.ts" <<'EOF'
import { createWorkflowHandler } from "veryfront/workflow";
import { workflows } from "../../../../lib/workflows.ts";

export const { GET, POST } = createWorkflowHandler(workflows);
EOF

DEV_PORT="${VF_NPM_SSR_SMOKE_PORT:-43119}"
DEV_URL="http://127.0.0.1:$DEV_PORT/"
DEV_LOG="$WORKDIR/veryfront-dev.log"
DEV_RESPONSE="$WORKDIR/veryfront-response.html"
API_RESPONSE="$WORKDIR/veryfront-api-response.json"

CI=1 \
NO_COLOR=1 \
NODE_ENV=development \
LOG_FORMAT=text \
VERYFRONT_NO_UPDATE_CHECK=1 \
VF_DISABLE_LRU_INTERVAL=1 \
SSR_TRANSFORM_PER_PROJECT_LIMIT=0 \
REVALIDATION_PER_PROJECT_LIMIT=0 \
ANTHROPIC_API_KEY=npm-smoke-key \
ANTHROPIC_BASE_URL="${DEV_URL}api/npm-black-hole" \
VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS=true \
node node_modules/veryfront/bin/veryfront.js dev --port "$DEV_PORT" --no-hmr \
  </dev/null >"$DEV_LOG" 2>&1 &
DEV_PID=$!

DEV_READY=""
for _attempt in $(seq 1 120); do
  kill -0 "$DEV_PID" 2>/dev/null || break
  if grep -q "Ready in" "$DEV_LOG"; then
    DEV_READY="yes"
    break
  fi
  sleep 0.25
done

if [ "$DEV_READY" != "yes" ]; then
  cat "$DEV_LOG" >&2
  fail "packed ai-agent starter dev server did not become ready"
fi

DEV_STATUS="$(curl --silent --show-error --max-time 30 \
  --output "$DEV_RESPONSE" --write-out '%{http_code}' "$DEV_URL" || true)"

if [ "$DEV_STATUS" != "200" ]; then
  cat "$DEV_LOG" >&2
  fail "packed ai-agent starter did not return HTTP 200 (last status: ${DEV_STATUS:-none})"
fi

grep -Eq '<title[^>]*>Assistant</title>' "$DEV_RESPONSE" || {
  head -c 2000 "$DEV_RESPONSE" >&2
  fail "packed ai-agent starter response did not contain its title"
}

API_STATUS="$(curl --silent --show-error --max-time 30 \
  --output "$API_RESPONSE" --write-out '%{http_code}' "${DEV_URL}api/npm-smoke" || true)"

if [ "$API_STATUS" != "200" ]; then
  cat "$DEV_LOG" >&2
  fail "packed npm API route did not return HTTP 200 (last status: ${API_STATUS:-none})"
fi

API_BODY="$(cat "$API_RESPONSE")"
if [ "$API_BODY" != '{"ok":true}' ]; then
  cat "$DEV_LOG" >&2
  fail "packed npm API route returned an unexpected body: $API_BODY"
fi

if grep -Eq \
  "Could not resolve relative import|Cached module has missing dependency|Critical page module failed to load|Failed to preload TSX layout|Cannot find module.*_dnt" \
  "$DEV_LOG"; then
  cat "$DEV_LOG" >&2
  fail "packed ai-agent starter logged an SSR module-resolution failure"
fi

echo "== 8. packed workflow: provider hang reaches a durable timeout"
node --input-type=module - "$DEV_URL" <<'EOF' || {
const rootUrl = process.argv[2];
const startResponse = await fetch(new URL("api/workflows/timeout-smoke/start", rootUrl), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ input: { message: "hello" } }),
  signal: AbortSignal.timeout(30_000),
});
const started = await startResponse.json();
if (!startResponse.ok || typeof started.runId !== "string" || started.runId.length === 0) {
  throw new Error(`Workflow start failed (${startResponse.status}): ${JSON.stringify(started)}`);
}

const detailUrl = new URL(`api/workflows/runs/${started.runId}`, rootUrl);
const pollingDeadline = Date.now() + 10_000;
let run;
while (Date.now() < pollingDeadline) {
  const response = await fetch(detailUrl, { signal: AbortSignal.timeout(5_000) });
  if (response.ok) {
    run = await response.json();
    if (run.nodeStates?.["call-provider"]?.status === "failed") break;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const node = run?.nodeStates?.["call-provider"];
if (node?.status !== "failed") {
  throw new Error(`Workflow did not reach terminal failure: ${JSON.stringify(run)}`);
}
if (typeof node.error !== "string" || !node.error.includes("timed out after 2000ms")) {
  throw new Error(`Workflow reported the wrong failure: ${JSON.stringify(node)}`);
}

const health = await fetch(new URL("api/npm-smoke", rootUrl), {
  signal: AbortSignal.timeout(5_000),
});
if (!health.ok) throw new Error(`Server unhealthy after timeout: HTTP ${health.status}`);
EOF
  cat "$DEV_LOG" >&2
  fail "packed workflow timeout journey failed"
}

grep -q "NPM_SMOKE_BLACK_HOLE_RECEIVED" "$DEV_LOG" || {
  cat "$DEV_LOG" >&2
  fail "packed workflow timed out before reaching the provider transport"
}

stop_dev_server

echo "npm install smoke: all checks passed"
