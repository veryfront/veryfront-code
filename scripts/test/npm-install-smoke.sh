#!/usr/bin/env bash
# Clean-room install/import smoke for the generated npm packages.
#
# Verifies, against the real `deno task build:npm` artifacts installed into a
# throwaway npm project, that:
#   1. the root `veryfront` package contains no CSS implementation while its
#      independently published CSS extension packages are generated
#   2. a `veryfront` install with co-published required packages runs the CLI
#      and activates the parser and offline Dev UI extensions under Node
#   3. the parser-only/evaluator worker transport and model-runtime streaming
#      run under Node 18 without unsupported Web Streams APIs
#   4. loading a missing extension fails naming the installable package
#   5. installing @veryfront/ext-auth-jwt makes the extension load
#   6. a broken transitive dependency surfaces the real error, not a
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
[ -d "$ROOT_DIR/npm/extensions/ext-dev-ui-react" ] || fail "ext-dev-ui-react package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-llm-anthropic" ] || fail "ext-llm-anthropic package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-llm-google" ] || fail "ext-llm-google package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-llm-openai" ] || fail "ext-llm-openai package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-css-lightning" ] || fail "ext-css-lightning package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-css-purgecss" ] || fail "ext-css-purgecss package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-css-tailwind" ] || fail "ext-css-tailwind package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-parser-babel" ] || fail "ext-parser-babel package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-schema-zod" ] || fail "ext-schema-zod package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-yaml" ] || fail "ext-yaml package output missing"
[ -d "$ROOT_DIR/npm/extensions/ext-auth-jwt" ] || fail "ext-auth-jwt package output missing"

(cd "$ROOT_DIR/npm" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-bundler-esbuild" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-content-mdx" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-dev-ui-react" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-llm-anthropic" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-llm-google" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-llm-openai" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-parser-babel" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-schema-zod" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-yaml" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)
(cd "$ROOT_DIR/npm/extensions/ext-auth-jwt" && npm pack --silent --pack-destination "$WORKDIR" >/dev/null)

cd "$WORKDIR"
npm init -y >/dev/null 2>&1
npm install --no-fund --no-audit --silent --ignore-scripts ./veryfront-[0-9]*.tgz ./veryfront-ext-bundler-esbuild-*.tgz ./veryfront-ext-content-mdx-*.tgz ./veryfront-ext-dev-ui-react-*.tgz ./veryfront-ext-llm-anthropic-*.tgz ./veryfront-ext-llm-google-*.tgz ./veryfront-ext-llm-openai-*.tgz ./veryfront-ext-parser-babel-*.tgz ./veryfront-ext-schema-zod-*.tgz ./veryfront-ext-yaml-*.tgz

echo "== 1. root install excludes independently published CSS implementations"
node -e "
const p = require('./node_modules/veryfront/package.json');
const forbidden = [
  '@veryfront/ext-css-lightning',
  '@veryfront/ext-css-purgecss',
  '@veryfront/ext-css-tailwind',
];
for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const name of forbidden) {
    if (Object.hasOwn(p[section] ?? {}, name)) {
      throw new Error(section + ' pulls CSS implementation ' + name + ' into root');
    }
  }
}
" || fail "root package metadata includes a CSS extension"
for css_extension in ext-css-lightning ext-css-purgecss ext-css-tailwind; do
  [ ! -e "node_modules/veryfront/esm/extensions/$css_extension" ] ||
    fail "root package bundles CSS implementation source: $css_extension"
done

echo "== 2. root install: CLI and parser extension run under Node"
node node_modules/veryfront/bin/veryfront.js --version | grep -q "Veryfront CLI" ||
  fail "CLI --version failed on root install"
node node_modules/veryfront/bin/veryfront.js schema --json >/dev/null ||
  fail "CLI schema --json failed on root install (bundled ext-schema-zod broken)"
node -e "
const p = require('./node_modules/veryfront/package.json');
if (p.dependencies?.['@veryfront/ext-parser-babel'] !== p.version) process.exit(1);
if (p.dependencies?.['@veryfront/ext-dev-ui-react'] !== p.version) process.exit(1);
if (p.dependencies?.['@veryfront/ext-llm-anthropic'] !== p.version) process.exit(1);
if (p.dependencies?.['@veryfront/ext-llm-google'] !== p.version) process.exit(1);
if (p.dependencies?.['@veryfront/ext-llm-openai'] !== p.version) process.exit(1);
if (p.dependencies?.['@veryfront/ext-schema-zod'] !== p.version) process.exit(1);
if (p.dependencies?.['@veryfront/ext-yaml'] !== p.version) process.exit(1);
" || fail "root package does not pin its auto-loaded extensions to its version"
mkdir -p skill-smoke
cat > skill-smoke/SKILL.md <<'EOF'
---
name: skill-smoke
description: Validate extension-backed YAML parsing
---
Smoke instructions.
EOF
node node_modules/veryfront/bin/veryfront.js skills validate ./skill-smoke |
  grep -q 'is valid' ||
  fail "SkillDocumentParserProvider was not registered through npm CLI skills validate"
node --input-type=module -e "
await import('./node_modules/veryfront/esm/_dnt.polyfills.js');
const resolver = await import(
  './node_modules/veryfront/esm/src/platform/compat/framework-source-resolver.js'
);
const path = await import('node:path');
const resolved = await resolver.resolveFrameworkSourcePath('react/public');
const expectedPath = path.resolve(
  'node_modules/veryfront/esm/src/react/public.js',
);
if (resolved?.path !== expectedPath) {
  throw new Error(
    'react/public resolved to ' + String(resolved?.path) +
      ' instead of ' + expectedPath,
  );
}
const fs = await import('node:fs/promises');
const packageJson = JSON.parse(
  await fs.readFile('./node_modules/veryfront/package.json', 'utf8'),
);
if (Object.hasOwn(packageJson.exports ?? {}, './react/public')) {
  throw new Error('./react/public leaked into published package exports');
}
" || fail "installed framework resolver did not find the private react/public artifact"
node --input-type=module -e "
const m = await import('./node_modules/veryfront/esm/src/extensions/builtin-extensions.js');
const deferredModule = await import(
  './node_modules/veryfront/esm/src/extensions/deferred-extension.js'
);
const resolved = m.createOptionalBuiltinExtension({
  name: 'ext-parser-babel',
  origin: 'veryfront/ext-parser-babel',
  sourceDirectory: 'ext-parser-babel',
  contracts: { provides: ['CodeParser'] },
  capabilities: [],
});
let codeParser;
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const deferred = deferredModule.getDeferredExtensionState(resolved);
if (!deferred) throw new Error('parser extension was not deferred');
const extension = await deferred.load(logger);
if (!extension) throw new Error('parser extension did not load');
await extension.setup({
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
" || fail "root optional builtin did not register a working CodeParser"
node --input-type=module -e "
const m = await import('./node_modules/veryfront/esm/src/extensions/builtin-extensions.js');
const deferredModule = await import(
  './node_modules/veryfront/esm/src/extensions/deferred-extension.js'
);
const resolved = m.createBuiltinExtensions().find(
  (candidate) => candidate.extension.name === 'ext-dev-ui-react',
);
if (!resolved) throw new Error('Dev UI builtin candidate is missing');
const deferred = deferredModule.getDeferredExtensionState(resolved);
if (!deferred) throw new Error('Dev UI extension was not deferred');
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const extension = await deferred.load(logger);
if (!extension) throw new Error('Dev UI extension did not load');
let devUiAssetProvider;
await extension.setup({
  get() {},
  require() { throw new Error('unexpected contract requirement'); },
  provide(name, impl) {
    if (name === 'DevUiAssetProvider') devUiAssetProvider = impl;
  },
  config: {},
  logger,
});
if (!devUiAssetProvider) {
  throw new Error('DevUiAssetProvider was not registered');
}
const bundle = devUiAssetProvider.browserBundle;
if (
  typeof bundle !== 'string' ||
  !bundle.includes('data-veryfront-dev-ui-styles') ||
  !bundle.includes('.bg-vf-bg')
) {
  throw new Error('DevUiAssetProvider does not contain the offline JS/CSS artifact');
}
if (
  /\\b(?:react(?:-jsx-runtime)?|react-dom(?:-client)?|scheduler)\\.development\\.js\\b/i.test(bundle)
) {
  throw new Error('Dev UI artifact contains a React development build');
}
await extension.teardown?.();
" || fail "root optional builtin did not register the offline DevUiAssetProvider"

echo "== 3. parser-only evaluator worker transport runs under Node 18"
[ "$(node --version)" = "v18.18.0" ] ||
  fail "pinned Node 18.18.0 runtime is unavailable"
PARSER_ONLY_ENTRY="$(node -e "
const p = require('./node_modules/@veryfront/ext-parser-babel/package.json');
const entry = p.exports?.['./parser-only'];
process.stdout.write(typeof entry === 'string' ? entry : entry?.import ?? '');
")"
[ -n "$PARSER_ONLY_ENTRY" ] ||
  fail "@veryfront/ext-parser-babel/parser-only export is missing"
PARSER_ONLY_ARTIFACT="node_modules/@veryfront/ext-parser-babel/${PARSER_ONLY_ENTRY#./}"
[ -f "$PARSER_ONLY_ARTIFACT" ] ||
  fail "parser-only export target is missing: $PARSER_ONLY_ENTRY"
grep -Eq "(from|import) [\"'](@babel/(generator|traverse)|debug)([\"'/])" \
  "$PARSER_ONLY_ARTIFACT" &&
  fail "parser-only artifact statically loads full Babel tooling"

FULL_BABEL_DIRS=()
while IFS= read -r package_dir; do
  FULL_BABEL_DIRS+=("$package_dir")
done < <(
  find node_modules -type d \
    \( -path '*/@babel/generator' -o -path '*/@babel/traverse' -o -path '*/debug' \) \
    -prune
)
for package_dir in "${FULL_BABEL_DIRS[@]}"; do
  [ ! -d "$package_dir" ] || mv "$package_dir" "$package_dir.smoke-removed"
done

node --input-type=module -e "
const parserOnly = await import('@veryfront/ext-parser-babel/parser-only');
const parser = new parserOnly.BabelParseOnlyParser();
const ast = await parser.parse({
  code: 'export default { direct: true };',
  filePath: 'veryfront.config.ts',
});
if (ast?.type !== 'File') throw new Error('parser-only subpath parse failed');

const runtimeBridge = await import(
  './node_modules/veryfront/esm/src/runtime/runtime-bridge.js'
);
const createRuntimeStream = (includeRawChunks = false) =>
  new ReadableStream({
    start(controller) {
      if (includeRawChunks) {
        controller.enqueue({
          type: 'raw',
          rawValue: { provider: 'smoke', chunk: 1 },
        });
      }
      controller.enqueue({ type: 'text-delta', delta: 'Node 18' });
      controller.enqueue({ type: 'finish', finishReason: 'stop' });
      controller.close();
    },
  });
const streamModel = {
  provider: 'smoke',
  modelId: 'smoke/node-18-stream',
  specificationVersion: 'v3',
  doGenerate() {
    throw new Error('unexpected doGenerate');
  },
  async doStream(options) {
    return {
      stream: createRuntimeStream(options?.includeRawChunks === true),
    };
  },
};
const live = runtimeBridge.streamText({
  model: streamModel,
  messages: [{ role: 'user', content: 'stream' }],
  includeRawChunks: true,
});
const liveParts = [];
for await (const part of live.fullStream) liveParts.push(part);
if (
  liveParts.length !== 3 ||
  liveParts[0]?.type !== 'raw' ||
  liveParts[0]?.rawValue?.provider !== 'smoke' ||
  liveParts[1]?.type !== 'text-delta' ||
  liveParts[1]?.text !== 'Node 18' ||
  liveParts[2]?.type !== 'finish'
) {
  throw new Error('runtime stream bridge returned the wrong Node 18 events');
}
const generated = await runtimeBridge.generateText({
  model: { ...streamModel, _generateViaStream: true },
  messages: [{ role: 'user', content: 'generate' }],
});
if (generated.text !== 'Node 18' || generated.finishReason !== 'stop') {
  throw new Error('stream-backed generation failed under Node 18');
}

const evaluator = await import(
  './node_modules/veryfront/esm/src/config/declarative-evaluator.js'
);
const runner = await import(
  './node_modules/veryfront/esm/src/config/declarative-evaluator-worker-runner.js'
);
const captureFailure = async (label, action) => {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error(label + ' unexpectedly succeeded');
};
const assertErrorTuple = (label, error, expected) => {
  if (typeof error !== 'object' || error === null) {
    throw new Error(label + ' did not return an error object');
  }
  for (const field of ['code', 'phase', 'reason', 'retryable']) {
    if (error[field] !== expected[field]) {
      throw new Error(
        label + ' returned the wrong ' + field + ': ' + String(error[field]),
      );
    }
  }
};
const assertNoLeakage = (label, error, forbiddenValues) => {
  const exposed = [
    String(error),
    error?.message,
    error?.stack,
    JSON.stringify(error),
  ].map((value) => String(value ?? '')).join('\\n');
  for (const forbidden of forbiddenValues) {
    if (forbidden && exposed.includes(forbidden)) {
      throw new Error(label + ' leaked a source or secret sentinel');
    }
  }
  if (
    Object.hasOwn(error, 'source') ||
    Object.hasOwn(error, 'sourceText') ||
    Object.hasOwn(error, 'cause')
  ) {
    throw new Error(label + ' exposed an unsafe error field');
  }
};
const context = await evaluator.prepareDeclarativeConfigContext({
  environmentName: 'production',
  environment: {},
});
const createPayload = (source) =>
  evaluator.createPreparedDeclarativeConfigWorkerPayload(source, context);
const payload = createPayload(
  'export default { ready: true, nested: { value: 18 } };',
);
const snapshot = await runner.evaluatePreparedDeclarativeConfigInWorker(payload);
if (snapshot.ready !== true || snapshot.nested?.value !== 18) {
  throw new Error('declarative evaluator returned the wrong snapshot');
}
if (
  Object.getPrototypeOf(snapshot) !== null ||
  Object.getPrototypeOf(snapshot.nested) !== null ||
  !Object.isFrozen(snapshot) ||
  !Object.isFrozen(snapshot.nested)
) {
  throw new Error('declarative evaluator snapshot invariants failed');
}

const secretName = 'VF_NPM_SMOKE_WORKER_SECRET';
const secretValue = 'vf-worker-secret-value-7f3c';
const forbiddenSource =
  'export default { secret: process.env.' + secretName + ' };';
process.env[secretName] = secretValue;
const forbiddenError = await captureFailure(
  'forbidden-access evaluator failure',
  () => runner.evaluatePreparedDeclarativeConfigInWorker(createPayload(forbiddenSource)),
);
delete process.env[secretName];
assertErrorTuple('forbidden-access evaluator failure', forbiddenError, {
  code: 'forbidden-capability',
  phase: 'validate',
  reason: 'unsupported-call',
  retryable: false,
});
if (forbiddenError.location?.fileName !== 'veryfront.config.ts') {
  throw new Error('forbidden-access evaluator failure lost its safe location');
}
assertNoLeakage(
  'forbidden-access evaluator failure',
  forbiddenError,
  [secretName, secretValue, forbiddenSource, 'process.env'],
);

const abortSource = 'export default { marker: \\'vf-pre-abort-source-marker\\' };';
const abortController = new AbortController();
abortController.abort();
const abortError = await captureFailure(
  'pre-aborted worker evaluation',
  () =>
    runner.evaluatePreparedDeclarativeConfigInWorker(
      createPayload(abortSource),
      { signal: abortController.signal },
    ),
);
assertErrorTuple('pre-aborted worker evaluation', abortError, {
  code: 'evaluator-unavailable',
  phase: 'worker',
  reason: 'worker-aborted',
  retryable: false,
});
assertNoLeakage('pre-aborted worker evaluation', abortError, [abortSource]);

const workerEntryPath = (
  await import('node:path')
).resolve(
  'node_modules/veryfront/esm/src/config/declarative-evaluator-worker-entry.js',
);
const savedWorkerEntryPath = workerEntryPath + '.smoke-saved';
const nodeFs = await import('node:fs/promises');
await nodeFs.rename(workerEntryPath, savedWorkerEntryPath);
const exitSource = 'export default { marker: \\'vf-worker-exit-source-marker\\' };';
let exitError;
try {
  await nodeFs.writeFile(
    workerEntryPath,
    'await new Promise((resolve) => setTimeout(resolve, 10));\\n',
  );
  exitError = await captureFailure(
    'worker exit transport',
    () =>
      runner.evaluatePreparedDeclarativeConfigInWorker(
        createPayload(exitSource),
        { timeoutMs: 1000 },
      ),
  );
} finally {
  await nodeFs.unlink(workerEntryPath).catch(() => {});
  await nodeFs.rename(savedWorkerEntryPath, workerEntryPath);
}
assertErrorTuple('worker exit transport', exitError, {
  code: 'evaluator-unavailable',
  phase: 'worker',
  reason: 'worker-unavailable',
  retryable: true,
});
assertNoLeakage('worker exit transport', exitError, [exitSource]);

const deadlineSource =
  'export default { marker: \\'vf-worker-deadline-source-marker\\' };';
const deadlineError = await captureFailure(
  'worker deadline transport',
  () =>
    runner.evaluatePreparedDeclarativeConfigInWorker(
      createPayload(deadlineSource),
      { timeoutMs: 1 },
    ),
);
assertErrorTuple('worker deadline transport', deadlineError, {
  code: 'evaluator-unavailable',
  phase: 'worker',
  reason: 'worker-timeout',
  retryable: true,
});
assertNoLeakage('worker deadline transport', deadlineError, [deadlineSource]);
" || fail "parser-only declarative evaluator failed under Node 18"

for package_dir in "${FULL_BABEL_DIRS[@]}"; do
  [ ! -d "$package_dir.smoke-removed" ] ||
    mv "$package_dir.smoke-removed" "$package_dir"
done

echo "== 4. root install: missing extension failure names the installable package"
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

echo "== 5. with @veryfront/ext-auth-jwt installed: extension loads"
npm install --no-fund --no-audit --silent --ignore-scripts ./veryfront-ext-auth-jwt-*.tgz
node -e "
import('./node_modules/veryfront/esm/src/extensions/first-party-import.js').then(async (m) => {
  const mod = await m.importFirstPartyExtensionModule('ext-auth-jwt', '@veryfront/ext-auth-jwt');
  if (typeof mod.createAuthProvider !== 'function') process.exit(1);
});
" || fail "ext-auth-jwt did not load after installing @veryfront/ext-auth-jwt"

echo "== 6. broken transitive dependency surfaces the real error"
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
