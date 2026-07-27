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
#
# Requires: `deno task build:npm` output in ./npm, node + npm on PATH.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

[ -d "$ROOT_DIR/npm" ] || fail "npm build output missing; run 'deno task build:npm' first"
[ -d "$ROOT_DIR/npm/extensions/ext-bundler-esbuild" ] || fail "ext-bundler-esbuild package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-content-mdx" ] || fail "ext-content-mdx package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-css-tailwind" ] || fail "ext-css-tailwind package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-parser-babel" ] || fail "ext-parser-babel package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-auth-jwt" ] || fail "ext-auth-jwt package output missing"

(cd "$ROOT_DIR/npm" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-bundler-esbuild" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-content-mdx" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-css-tailwind" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-parser-babel" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-auth-jwt" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)

cd "$WORKDIR"
npm init -y >/dev/null 2>&1
npm install --no-fund --no-audit --silent --ignore-scripts ./veryfront-[0-9]*.tgz ./veryfront-ext-bundler-esbuild-*.tgz ./veryfront-ext-content-mdx-*.tgz ./veryfront-ext-css-tailwind-*.tgz ./veryfront-ext-parser-babel-*.tgz

echo "== 1. root install: CLI and parser extension run under Node"
node node_modules/veryfront/bin/veryfront.js --version | grep -q "Veryfront CLI" ||
  fail "CLI --version failed on root install"
node node_modules/veryfront/bin/veryfront.js schema --json >/dev/null ||
  fail "CLI schema --json failed on root install (bundled ext-schema-zod broken)"
node -e "
const p = require('./node_modules/veryfront/package.json');
if (p.dependencies?.['@veryfront/ext-parser-babel'] !== p.version) process.exit(1);
" || fail "root package does not pin @veryfront/ext-parser-babel to its version"
node --input-type=module -e "
const m = await import('./node_modules/veryfront/esm/src/extensions/builtin-extensions.js');
const resolved = m.createOptionalBuiltinExtension({
  name: 'ext-parser-babel',
  origin: 'veryfront/ext-parser-babel',
  sourceDirectory: 'ext-parser-babel',
  contracts: { provides: ['CodeParser'] },
  capabilities: [],
});
let codeParser;
const logger = { debug() {}, info() {}, warn() {}, error() {} };
await resolved.extension.setup({
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
await resolved.extension.teardown?.();
" || fail "root optional builtin did not register a working CodeParser"

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

echo "npm install smoke: all checks passed"
