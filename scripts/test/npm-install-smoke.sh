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
#   7. the packed ai-agent starter starts under Node and renders over HTTP
#      without unresolved generated runtime helpers
#   8. an API route in that starter loads and responds on a Node that lacks the
#      Uint8Array base64/hex proposal (issue #3968)
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

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

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

cd "$WORKDIR"
npm init -y >/dev/null 2>&1
npm pkg set type=module >/dev/null
npm install --no-fund --no-audit --silent --ignore-scripts ./veryfront-[0-9]*.tgz ./veryfront-ext-bundler-esbuild-*.tgz ./veryfront-ext-content-mdx-*.tgz ./veryfront-ext-css-tailwind-*.tgz ./veryfront-ext-dev-ui-react-*.tgz ./veryfront-ext-node-websocket-ws-*.tgz ./veryfront-ext-parser-babel-*.tgz ./veryfront-ext-yaml-*.tgz

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
npm install --no-fund --no-audit --silent --ignore-scripts ./veryfront-ext-auth-jwt-*.tgz
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
const names = listScaffoldTemplates();
for (const name of ['minimal', 'ai-agent', 'agentic-workflow']) {
  if (!names.includes(name)) throw new Error('scaffold cannot create ' + name);
}
const { files } = await materializeScaffold({
  template: 'minimal',
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
" || fail "veryfront/scaffold did not resolve from an installed package"

echo "== 7. packed ai-agent starter: dev server renders over HTTP"
cp -R "$ROOT_DIR/templates/files/ai-agent/." "$WORKDIR/"

DEV_PORT="${VF_NPM_SSR_SMOKE_PORT:-43119}"
DEV_URL="http://127.0.0.1:$DEV_PORT/"
DEV_LOG="$WORKDIR/veryfront-dev.log"
DEV_RESPONSE="$WORKDIR/veryfront-response.html"

CI=1 \
NO_COLOR=1 \
NODE_ENV=development \
LOG_FORMAT=text \
VERYFRONT_NO_UPDATE_CHECK=1 \
VF_DISABLE_LRU_INTERVAL=1 \
SSR_TRANSFORM_PER_PROJECT_LIMIT=0 \
REVALIDATION_PER_PROJECT_LIMIT=0 \
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

if grep -Eq \
  "Could not resolve relative import|Cached module has missing dependency|Critical page module failed to load|Failed to preload TSX layout|Cannot find module.*_dnt" \
  "$DEV_LOG"; then
  cat "$DEV_LOG" >&2
  fail "packed ai-agent starter logged an SSR module-resolution failure"
fi

stop_dev_server

echo "== 8. API route loads on a Node without the Uint8Array base64/hex proposal"
# Regression guard for issue #3968: the API module loader hashed route source
# with `new Uint8Array(digest).toHex()`. That method is native and unflagged in
# Deno, so the Deno-native suite never saw it, and it is absent from every Node
# release before 25 -- so `veryfront dev` returned 500 for *every* API route on
# the supported Node floor while this smoke test stayed green, because step 7
# only ever requests `/`.
#
# The methods are stripped explicitly rather than relying on the runner's Node
# version. Node 25 ships them unflagged, so a version-dependent check would go
# quietly vacuous the moment CI moves off Node 24.
mkdir -p "$WORKDIR/app/api/health"
cat > "$WORKDIR/app/api/health/route.ts" <<'ROUTE'
export async function GET() {
  return Response.json({ ok: true });
}
ROUTE

cat > "$WORKDIR/strip-uint8array-proposal.mjs" <<'PRELOAD'
// Simulate the oldest supported Node: remove the Uint8Array base64/hex
// proposal that Deno provides natively.
for (const method of ["toHex", "toBase64", "setFromHex", "setFromBase64"]) {
  delete Uint8Array.prototype[method];
}
for (const method of ["fromHex", "fromBase64"]) {
  delete Uint8Array[method];
}
PRELOAD

# Negative control: prove the preload actually removes the methods. Without
# this, a preload that silently stopped working would leave the whole step
# passing for the wrong reason on a Node that still has them.
node --import "$WORKDIR/strip-uint8array-proposal.mjs" -e '
if (typeof Uint8Array.prototype.toHex === "function") process.exit(1);
if (typeof Uint8Array.prototype.toBase64 === "function") process.exit(1);
' || fail "strip preload did not remove the Uint8Array proposal methods"

API_PORT="${VF_NPM_API_SMOKE_PORT:-43121}"
API_LOG="$WORKDIR/veryfront-dev-api.log"
API_RESPONSE="$WORKDIR/veryfront-api-response.json"

CI=1 \
NO_COLOR=1 \
NODE_ENV=development \
LOG_FORMAT=text \
VERYFRONT_NO_UPDATE_CHECK=1 \
VF_DISABLE_LRU_INTERVAL=1 \
SSR_TRANSFORM_PER_PROJECT_LIMIT=0 \
REVALIDATION_PER_PROJECT_LIMIT=0 \
node --import "$WORKDIR/strip-uint8array-proposal.mjs" \
  node_modules/veryfront/bin/veryfront.js dev --port "$API_PORT" --no-hmr \
  </dev/null >"$API_LOG" 2>&1 &
DEV_PID=$!

API_READY=""
for _attempt in $(seq 1 120); do
  kill -0 "$DEV_PID" 2>/dev/null || break
  if grep -q "Ready in" "$API_LOG"; then
    API_READY="yes"
    break
  fi
  sleep 0.25
done

if [ "$API_READY" != "yes" ]; then
  cat "$API_LOG" >&2
  fail "dev server did not become ready without the Uint8Array proposal"
fi

API_STATUS="$(curl --silent --show-error --max-time 30 \
  --output "$API_RESPONSE" --write-out '%{http_code}' \
  "http://127.0.0.1:$API_PORT/api/health" || true)"

if [ "$API_STATUS" != "200" ]; then
  echo "--- response body ---" >&2
  head -c 2000 "$API_RESPONSE" >&2
  echo >&2
  cat "$API_LOG" >&2
  fail "API route returned ${API_STATUS:-none}, expected 200 (issue #3968)"
fi

grep -q '"ok":true' "$API_RESPONSE" ||
  fail "API route did not return its JSON body: $(head -c 500 "$API_RESPONSE")"

if grep -q "is not a function" "$API_LOG"; then
  cat "$API_LOG" >&2
  fail "dev server logged a missing-method failure while serving the API route"
fi

stop_dev_server

echo "npm install smoke: all checks passed"
