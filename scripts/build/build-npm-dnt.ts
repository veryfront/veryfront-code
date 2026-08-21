/**
 * Build script for publishing Veryfront to npm using dnt
 *
 * Much simpler than the esbuild-based approach - dnt handles:
 * - Deno → Node module transformation
 * - TypeScript declarations
 * - Import map resolution
 * - Shims for Deno APIs
 *
 * Usage:
 *   deno run -A scripts/build-npm-dnt.ts
 */

import { build, emptyDir } from "#dnt";
import { STANDARD_ROOT_NPM_EXTENSION_DIRECTORIES } from "#veryfront/extensions/first-party-defaults.ts";
import { PUBLISHED_RUNTIME_HELPERS } from "../../src/platform/compat/published-runtime-helpers.ts";
import {
	BROWSER_SAFE_CLIENT_MODULES,
	BROWSER_SAFE_DNT_TIMER_MODULES,
	BROWSER_SAFE_EXPORTS,
} from "./browser-safe-exports.mjs";
import {
	npmDependencyRange,
	readDenoConfigSet,
} from "./npm-dependency-sources.ts";
import { buildExtensionPackages } from "./build-npm-extension-packages.ts";
import {
	patchDntArgvPolyfill,
	patchDntCryptoShim,
	patchDntDenoShim,
} from "./dnt-polyfill.ts";
import { normalizeNpmPackageMetadata } from "./npm-package-metadata.ts";
import { assertNpmRuntimeHelperContract } from "./npm-runtime-helper-contract.ts";
import { normalizeEsmShReactNpmShims } from "./npm-react-shims.ts";
import { normalizeNpmJsxReactBinding } from "./npm-jsx-react-binding.ts";
import { NPM_NODE_ENGINE } from "./runtime-support.ts";

const denoJson = JSON.parse(await Deno.readTextFile("./deno.json"));
const version = denoJson.version;
if (!version) {
	throw new Error("deno.json must have a 'version' field");
}
const license = denoJson.license;
if (!license) {
	throw new Error("deno.json must have a 'license' field");
}
const denoConfigSet = await readDenoConfigSet(".", denoJson);

console.log(`\n📦 Building Veryfront v${version} for npm using dnt...\n`);

// Generate templates manifest before build
console.log("📝 Generating templates manifest...");
const genManifest = new Deno.Command("deno", {
	args: ["run", "-A", "scripts/build/generate-templates-manifest.ts"],
	stdout: "inherit",
	stderr: "inherit",
});
const { code: manifestCode } = await genManifest.output();
if (manifestCode !== 0) {
	throw new Error("Failed to generate templates manifest");
}

await emptyDir("./npm");

// Convert deno.json exports to dnt entry points
const entryPoints = Object.entries(denoJson.exports as Record<string, string>)
	.map(([name, path]) => ({ name, path }));

// Auto-derive esm.sh URL mappings from deno.json imports so versions stay in sync.
// dnt ignores mappings it doesn't encounter, so including all is safe.
const esmShMappings = buildEsmShMappings(denoJson.imports as Record<string, string>);

// npm range for the bare react/react-dom peer the emitted package imports (see
// the `./react/*.ts` mappings below). Derived from the pinned esm.sh version.
const reactRange = npmDependencyRange(
	denoConfigSet,
	"@veryfront/react-upstream",
	"^",
);

await build({
	entryPoints,
	outDir: "./npm",

	// Don't run tests during build (they're Deno-specific)
	test: false,

	// ESM only (no CommonJS) - allows top-level await
	scriptModule: false,

	// Skip type checking - runtime compatibility is verified by Deno's type checker
	// dnt's Node type environment differs significantly from Deno's web-standard types
	typeCheck: false,

	// Skip npm install - we run it manually with --legacy-peer-deps to avoid peer dep conflicts
	skipNpmInstall: true,

	// Package metadata
	//
	// `undici` and `blob` shims are intentionally disabled. With those enabled,
	// dnt injects `_dnt.shims.js → undici` (and `buffer`) imports into every
	// file that references fetch/Headers/Response/Blob — including client-bound
	// React runtime files like `src/react/runtime/core.ts`. The SSR http-cache
	// pipeline then tries to fetch `undici` from esm.sh, which returns 404
	// (esm.sh refuses to build Node-only packages with `external=react`).
	//
	// The supported Node runtime provides fetch/Headers/Response/Request/
	// FormData/File/Blob as globals natively, so no shim is needed.
	shims: {
		deno: true,
		// Supported Node releases provide native timers. Keeping the dnt timer shim here turns
		// Timeout objects into numbers, which prevents unrefTimer() from releasing
		// framework background intervals in short-lived Node processes.
		timers: false,
		crypto: true,
	},

	// Compiler options for declaration generation
	compilerOptions: {
		lib: ["ES2022", "DOM", "DOM.Iterable"],
		target: "ES2022",
		skipLibCheck: true,
	},

	// Map Deno std and type packages to npm equivalents
	mappings: {
		// esm.sh URLs - derived from deno.json imports
		...esmShMappings,
		// React must resolve to the CONSUMER's bare `react` / `react-dom` in the
		// emitted package. The repo pins react through the local `./react/*.ts`
		// deno shims (so Deno imports a stable esm.sh build); if dnt bundles those
		// into a local `npm/esm/react/react.js` and rewrites every component
		// import to it, the shim's multi-hop `export { HTMLAttributes, … } from`
		// re-export collapses `interface Props extends React.HTMLAttributes<…>` to
		// `{}` under a consumer's `tsc` — stripping `children`/`className`/handlers
		// from every component's public type (invisible to `deno check`). Mapping
		// the local shims straight to the bare npm specifiers makes emitted code
		// `import … from "react"`, so `React.HTMLAttributes` resolves against the
		// consumer's own `@types/react`. See scripts/typecheck/README.md.
		"./react/react.ts": { name: "react", version: reactRange },
		"./react/react-dom.ts": { name: "react-dom", version: reactRange },
		"./react/react-dom-client.ts": {
			name: "react-dom",
			version: reactRange,
			subPath: "client",
		},
		"./react/react-dom-server.ts": {
			name: "react-dom",
			version: reactRange,
			subPath: "server",
		},
		"./react/jsx-runtime.ts": {
			name: "react",
			version: reactRange,
			subPath: "jsx-runtime",
		},
		"./react/jsx-dev-runtime.ts": {
			name: "react",
			version: reactRange,
			subPath: "jsx-dev-runtime",
		},
	},

	package: {
		name: "veryfront",
		version,
		description: "The simplest way to build AI-powered apps",
		license,
		author: "Veryfront",
		repository: {
			type: "git",
			url: "git+https://github.com/veryfront/veryfront-code.git",
		},
		bugs: {
			url: "https://github.com/veryfront/veryfront-code/issues",
		},
		homepage: "https://veryfront.com",
		engines: {
			node: NPM_NODE_ENGINE,
		},
		// dnt can't detect dynamic imports, so we add them explicitly
		dependencies: {
			"@types/react": npmDependencyRange(denoConfigSet, "@types/react"),
			"@types/react-dom": npmDependencyRange(denoConfigSet, "@types/react-dom"),
		},
		keywords: [
			"react",
			"framework",
			"ai",
			"agents",
			"mcp",
			"llm",
			"ssr",
			"rsc",
			"typescript",
		],
		// postinstall added in postBuild after files are copied
	},

	// Post-build steps
	async postBuild() {
		// Before anything else reads the emit: dnt lowers JSX to the classic
		// `React.createElement`, which this repo's sources are not written for.
		// See npm-jsx-react-binding.ts.
		const jsxPatched = await normalizeNpmJsxReactBinding("./npm/esm");
		if (jsxPatched.length > 0) {
			console.log(
				`Gave ${jsxPatched.length} emitted module(s) a React binding:\n  ${
					jsxPatched.join("\n  ")
				}`,
			);
		}

		await assertNpmRuntimeHelperContract("./npm/esm", PUBLISHED_RUNTIME_HELPERS);

		const pkgPath = "./npm/package.json";
		const initialPkg = JSON.parse(await Deno.readTextFile(pkgPath));
		normalizeNpmPackageMetadata(initialPkg);
		await Deno.writeTextFile(pkgPath, JSON.stringify(initialPkg, null, 2));

		// Run npm install with scripts disabled to avoid supply-chain install hooks.
		// Keep --legacy-peer-deps to avoid peer dep conflicts
		// (e.g., @ai-sdk/react requires react ~19.1.2 but framework uses 19.1.1)
		const npmInstall = new Deno.Command("npm", {
			args: ["install", "--ignore-scripts", "--legacy-peer-deps"],
			cwd: "./npm",
			stdout: "inherit",
			stderr: "inherit",
		});
		const { code } = await npmInstall.output();
		if (code !== 0) {
			throw new Error(`npm install failed with exit code ${code}`);
		}

		// Copy RSC client files that are read at runtime (not imported as modules).
		// script-handlers.ts resolves these relative to import.meta.url.
		const rscClientFiles = ["client-boot.ts", "client-dom.ts", "hydrate-client.ts"];
		const rscSrc = "./src/rendering/rsc";
		const rscDest = "./npm/esm/src/rendering/rsc";
		await Deno.mkdir(rscDest, { recursive: true });
		for (const file of rscClientFiles) {
			await Deno.copyFile(`${rscSrc}/${file}`, `${rscDest}/${file}`);
		}
		console.log(`📝 Copied ${rscClientFiles.length} RSC client files`);

		// Fix dnt polyfill bug: process.argv[1] can be undefined in dynamic imports
		await patchDntArgvPolyfill(
			"./npm/esm/_dnt.polyfills.js",
			{ required: true },
		);

		// dnt re-exports `@deno/shim-deno` unconditionally, so `deno run -A
		// npm:veryfront` ran the Node reimplementations of Deno APIs instead of
		// the runtime's own. Deno.listen in particular reads `server._handle.fd`
		// off a node:net server, which is null under Deno's node compatibility
		// layer, so every command that binds a port died before starting.
		await patchDntDenoShim(
			"./npm/esm/_dnt.shims.js",
			{ required: true },
		);

		// Both shims must be lazy, not just the Deno one. The esm transform
		// rewrites each bare specifier into an absolute file:// bundle, and Deno
		// cannot prepare that graph node when node_modules is unmanaged, which is
		// what `deno install -g` writes (`nodeModulesDir: "manual"`). A single
		// remaining static shim import keeps a globally installed CLI failing
		// every request with "Loading unprepared module".
		await patchDntCryptoShim(
			"./npm/esm/_dnt.shims.js",
			{ required: true },
		);

		const patchedReactShimCount = normalizeEsmShReactNpmShims("./npm/esm/deps/esm.sh");
		if (patchedReactShimCount > 0) {
			console.log(`📝 Patched ${patchedReactShimCount} React ecosystem esm.sh npm shims`);
		}

		// Guard the react-mapping fix: emitted component `.d.ts` MUST import react
		// via the bare `react` specifier so `React.HTMLAttributes` resolves against
		// the consumer's `@types/react`. If dnt ever bundles a local react shim
		// again, `interface Props extends React.HTMLAttributes<…>` collapses to `{}`
		// for consumers (children/className/handlers vanish) while `deno check`
		// stays green. See scripts/typecheck/README.md.
		assertConsumerReactImport(
			"./npm/esm/src/react/components/ui/app-shell.d.ts",
		);

		// Keep browser-safe client exports free of dnt Node polyfill imports.
		// These modules are consumed directly in browser bundles and do not rely on
		// any Node-only globals, so retaining the injected side-effect import only
		// bloats the graph and breaks browser builds.
		for (const exportPath of BROWSER_SAFE_EXPORTS) {
			const sourcePath = (denoJson.exports as Record<string, string>)[exportPath];
			if (!sourcePath) {
				throw new Error(`Missing browser-safe export source for ${exportPath}`);
			}

			const builtJsPath = `./npm/esm/${sourcePath.replace(/\.tsx?$/, ".js").replace(/^\.\//, "")}`;
			const builtDtsPath = `./npm/esm/${sourcePath.replace(/\.tsx?$/, ".d.ts").replace(/^\.\//, "")}`;

			for (const path of [builtJsPath, builtDtsPath]) {
				stripPolyfillImportIfPresent(
					path,
					`${exportPath} browser-safe polyfill removal`,
				);
			}
		}

		for (const path of [
			...BROWSER_SAFE_CLIENT_MODULES,
			...BROWSER_SAFE_DNT_TIMER_MODULES,
		]) {
			normalizeBrowserTimerShim(
				`./npm/esm/${path}`,
				`${path} browser-safe dnt shim removal`,
			);
		}

		// Templates are embedded in a compressed generated module bundled by dnt.
		// No need to copy template files separately

		// Copy bin wrapper
		await Deno.mkdir("./npm/bin", { recursive: true });
		await Deno.copyFile("./scripts/build/bin-wrapper.js", "./npm/bin/veryfront.js");
		await Deno.chmod("./npm/bin/veryfront.js", 0o755);
		// The shim imports this before any framework module, so it has to sit
		// beside it and stay loadable on Node releases below the supported floor.
		await Deno.copyFile(
			"./scripts/build/node-engine-precondition.js",
			"./npm/bin/node-engine-precondition.js",
		);

		// Copy package documentation files (must exist at repo root)
		await Deno.mkdir("./npm/assets", { recursive: true });
		await Deno.copyFile("./assets/banner.svg", "./npm/assets/banner.svg");
		await Deno.copyFile("./LICENSE", "./npm/LICENSE");
		await Deno.copyFile("./NOTICE", "./npm/NOTICE");
		await Deno.copyFile("./README.md", "./npm/README.md");

		// Copy base tsconfig for user projects to extend
		await Deno.writeTextFile("./npm/tsconfig.json", JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "Bundler",
				jsx: "react-jsx",
				strict: true,
				skipLibCheck: true,
				esModuleInterop: true,
				noEmit: true,
			},
		}, null, 2));

		// Update package.json with bin entry and type
		const pkg = JSON.parse(await Deno.readTextFile(pkgPath));
		pkg.type = "module"; // Required for ESM imports without warnings
		pkg.types = "./esm/src/index.d.ts";
		pkg.bin = { veryfront: "bin/veryfront.js" };
		pkg.dependencies ??= {};
		// Add after build-local npm install so releases do not require the
		// just-built auto-loaded extension versions to already exist in the registry.
		for (const extensionDirectory of STANDARD_ROOT_NPM_EXTENSION_DIRECTORIES) {
			pkg.dependencies[`@veryfront/${extensionDirectory}`] = version;
		}
		pkg.files = ["esm", "script", "bin", "assets", "tsconfig.json", "LICENSE", "NOTICE", "README.md"];
		pkg.exports["./tsconfig.json"] = "./tsconfig.json";
		addTypesExportEntries(pkg.exports);
		normalizeNpmPackageMetadata(pkg);
		await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2));
	},
});

await buildExtensionPackages({
	rootDir: Deno.cwd(),
	outDir: `${Deno.cwd()}/npm/extensions`,
	rootConfig: denoJson,
	version,
	license,
});

await verifyNpmRootImportLifecycle();

async function verifyNpmRootImportLifecycle(): Promise<void> {
	const consumerDirectory = await Deno.makeTempDir({
		prefix: "veryfront-npm-lifecycle-",
	});
	try {
		await installBuiltNpmLifecycleConsumer(consumerDirectory);
		await runNpmRootImportLifecycleProbe(consumerDirectory);
	} finally {
		await Deno.remove(consumerDirectory, { recursive: true }).catch(() => undefined);
	}
}

async function installBuiltNpmLifecycleConsumer(consumerDirectory: string): Promise<void> {
	const localPackageDirectories = await Promise.all([
		Deno.realPath("./npm"),
		...STANDARD_ROOT_NPM_EXTENSION_DIRECTORIES.map((extensionDirectory) =>
			Deno.realPath(`./npm/extensions/${extensionDirectory}`)
		),
	]);
	await Deno.writeTextFile(
		`${consumerDirectory}/package.json`,
		JSON.stringify({ private: true, type: "module" }),
	);
	const install = await new Deno.Command("npm", {
		args: [
			"install",
			"--ignore-scripts",
			"--legacy-peer-deps",
			"--no-audit",
			"--no-fund",
			"--no-package-lock",
			"--install-links",
			...localPackageDirectories,
		],
		cwd: consumerDirectory,
		stdout: "piped",
		stderr: "piped",
	}).output();
	if (!install.success) {
		const stderr = new TextDecoder().decode(install.stderr).trim();
		throw new Error(
			`Built npm lifecycle consumer install failed with exit code ${install.code}.` +
				(stderr ? `\n${stderr}` : ""),
		);
	}
}

async function runNpmRootImportLifecycleProbe(consumerDirectory: string): Promise<void> {
	const timeoutMs = 10_000;
	const probeSource = `
const root = await import("veryfront");
if (typeof root.defineConfig !== "function") {
  throw new Error("defineConfig export missing");
}

const agent = await import("veryfront/agent");
const metadata = agent.parseRuntimeSkillMetadata(
  "---\\nname: public-api\\ndescription: Public API\\n---\\nBody",
);
if (metadata?.name !== "public-api") {
  throw new Error("public runtime Skill parser default unavailable");
}

const { createBuiltinExtensions, createEvalCliBuiltinExtensions } = await import(
  "./node_modules/veryfront/esm/src/extensions/builtin-extensions.js"
);
const { getDeferredExtensionState } = await import(
  "./node_modules/veryfront/esm/src/extensions/deferred-extension.js"
);
const {
  createEvalReportExporterRegistry,
  EvalReportExporterRegistryName,
} = await import("./node_modules/veryfront/esm/src/extensions/eval/index.js");

const registry = createEvalReportExporterRegistry();
const resolved = createEvalCliBuiltinExtensions(["mlflow"]).find(
  (entry) => entry.extension.name === "ext-eval-report-mlflow",
);
if (!resolved) throw new Error("bundled MLflow extension missing");

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

for (const [extensionName, contractName] of [
  ["ext-css-tailwind", "CSSProcessor"],
  ["ext-dev-ui-react", "DevUiAssetProvider"],
  ["ext-node-websocket-ws", "NodeWebSocketServerProvider"],
]) {
  const candidate = createBuiltinExtensions().find(
    (entry) => entry.extension.name === extensionName,
  );
  if (!candidate) throw new Error("standard builtin missing: " + extensionName);
  const standardDeferred = getDeferredExtensionState(candidate);
  if (!standardDeferred) throw new Error("standard builtin was not deferred: " + extensionName);
  const standardExtension = await standardDeferred.load(logger);
  if (!standardExtension) throw new Error("standard builtin failed to load: " + extensionName);
  let provided;
  await standardExtension.setup?.({
    get() {},
    require(contract) { throw new Error("unexpected extension contract: " + contract); },
    provide(contract, implementation) {
      if (contract === contractName) provided = implementation;
    },
    config: {},
    logger,
  });
  if (!provided) throw new Error("standard builtin did not provide " + contractName);
  await standardExtension.teardown?.();
}

const deferred = getDeferredExtensionState(resolved);
if (!deferred) throw new Error("bundled MLflow extension was not deferred");
const extension = await deferred.load(logger);
if (!extension) throw new Error("bundled MLflow extension failed to load");

const context = {
  get(contract) {
    return contract === EvalReportExporterRegistryName ? registry : undefined;
  },
  require(contract) {
    if (contract === EvalReportExporterRegistryName) return registry;
    throw new Error(\`unexpected extension contract: \${contract}\`);
  },
  provide(contract) {
    throw new Error(\`unexpected provided contract: \${contract}\`);
  },
  config: {},
  logger,
};

await extension.setup?.(context);
if (!registry.has("mlflow")) {
  throw new Error("bundled MLflow exporter did not register");
}
await extension.teardown?.();
if (registry.has("mlflow")) {
  throw new Error("bundled MLflow exporter did not unregister");
}
`;
	const child = new Deno.Command("node", {
		args: [
			"--input-type=module",
			"--eval",
			probeSource,
		],
		cwd: consumerDirectory,
		env: {
			MLFLOW_TRACKING_URI: "http://127.0.0.1:5000",
			VF_DISABLE_LRU_INTERVAL: "0",
		},
		stdout: "piped",
		stderr: "piped",
	}).spawn();
	const outputPromise = child.output();
	let timeoutId: number | undefined;
	const result = await Promise.race([
		outputPromise.then((output) => ({ kind: "complete" as const, output })),
		new Promise<{ kind: "timeout" }>((resolve) => {
			timeoutId = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
		}),
	]);

	if (timeoutId !== undefined) clearTimeout(timeoutId);

	if (result.kind === "timeout") {
		try {
			child.kill();
		} catch {
			// The process may exit between the timeout and the kill attempt.
		}
		const output = await outputPromise.catch(() => undefined);
		const stderr = output ? new TextDecoder().decode(output.stderr).trim() : "";
		throw new Error(
			`Built npm root import did not exit within ${timeoutMs}ms; ` +
				`a referenced import-time handle is still active.${stderr ? `\n${stderr}` : ""}`,
		);
	}

	if (!result.output.success) {
		const stderr = new TextDecoder().decode(result.output.stderr).trim();
		throw new Error(
			`Built npm root import failed with exit code ${result.output.code}.` +
				(stderr ? `\n${stderr}` : ""),
		);
	}

	console.log("✅ Verified npm root import and bundled MLflow lifecycle");
}

function addTypesExportEntries(
	exportsMap: Record<string, string | { import?: string; types?: string }>,
): void {
	for (const [exportKey, exportValue] of Object.entries(exportsMap)) {
		if (exportKey === "./tsconfig.json" || typeof exportValue === "string") {
			continue;
		}

		if (!exportValue.import || !exportValue.import.endsWith(".js")) {
			continue;
		}

		exportValue.types = exportValue.import.replace(/\.js$/, ".d.ts");
	}
}

/**
 * Assert an emitted component `.d.ts` imports React via the bare `react`
 * specifier (a consumer's own `@types/react`), not a bundled local react shim.
 * See the call site + scripts/typecheck/README.md for why this matters.
 */
function assertConsumerReactImport(path: string): void {
	const content = Deno.readTextFileSync(path);
	const bareImport = /import \* as React from ["']react["'];/.test(content);
	const shimImport = /import \* as React from ["'][^"']*\/react\/react\.js["'];/
		.test(content);
	if (!bareImport || shimImport) {
		throw new Error(
			`Consumer react-import guard failed for ${path}: emitted component ` +
				`types must import from the bare "react" specifier, not a bundled ` +
				`react shim, or every \`extends React.HTMLAttributes\` component ` +
				`ships with its DOM props stripped for consumers. See ` +
				`scripts/typecheck/README.md.`,
		);
	}
	console.log(`✅ Verified consumer react import in ${path}`);
}
function stripPolyfillImportIfPresent(
	path: string,
	description: string,
): void {
	const content = Deno.readTextFileSync(path);
	const polyfillImportPattern = /^import ["'](?:\.\.\/)+_dnt\.polyfills\.js["'];\n/m;
	const patched = content.replace(polyfillImportPattern, "");
	if (patched === content) {
		console.log(`ℹ️  ${description} not needed for ${path}`);
		return;
	}

	Deno.writeTextFileSync(path, patched);
	console.log(`📝 Patched ${description} in ${path}`);
}

function normalizeBrowserTimerShim(
	path: string,
	description: string,
): void {
	const content = Deno.readTextFileSync(path);
	const patched = content
		.replace(/^import \* as dntShim from ["'](?:\.\.\/)+_dnt\.shims\.js["'];\n/m, "")
		.replaceAll("dntShim.dntGlobalThis", "globalThis")
		.replaceAll("dntShim.Deno", "globalThis.Deno")
		.replaceAll("dntShim.dntGlobalThis.setTimeout", "globalThis.setTimeout")
		.replaceAll("dntShim.setTimeout", "globalThis.setTimeout")
		.replaceAll("dntShim.dntGlobalThis.clearTimeout", "globalThis.clearTimeout")
		.replaceAll("dntShim.clearTimeout", "globalThis.clearTimeout")
		.replaceAll("dntShim.dntGlobalThis.setInterval", "globalThis.setInterval")
		.replaceAll("dntShim.setInterval", "globalThis.setInterval")
		.replaceAll("dntShim.dntGlobalThis.clearInterval", "globalThis.clearInterval")
		.replaceAll("dntShim.clearInterval", "globalThis.clearInterval");

	if (patched === content) {
		console.log(`ℹ️  ${description} not needed for ${path}`);
		return;
	}

	Deno.writeTextFileSync(path, patched);
	console.log(`📝 Patched ${description} in ${path}`);
}

/**
 * Parse esm.sh URLs from deno.json imports into dnt mappings.
 * Only includes imports that dnt actually encounters in the build graph.
 * Type-only packages (@types/*, csstype) and client-only imports (react-dom,
 * react-dom/client) are excluded — dnt errors on unused mappings.
 */
function buildEsmShMappings(
	imports: Record<string, string>,
): Record<string, { name: string; version: string; subPath?: string }> {
	const mappings: Record<string, { name: string; version: string; subPath?: string }> = {};

	for (const [key, url] of Object.entries(imports)) {
		if (!url.startsWith("https://esm.sh/")) continue;

		// Skip packages not reached from npm entry points. dnt errors on unused mappings.
		// - @types/* and csstype: type-only, never in JS output
		// - react-dom (base) and react-dom/client: client-side only, not in server build graph
		if (key.startsWith("@types/") || key === "csstype") continue;
		if (key === "react-dom" || key === "react-dom/client") continue;

		// Strip prefix and query params: "react@19.1.1/jsx-runtime"
		const pathPart = url.replace("https://esm.sh/", "").split("?")[0]!;

		// Match scoped (@scope/name@version/subPath) or regular (name@version/subPath)
		const match = pathPart.match(/^(@[^/]+\/[^@]+|[^@]+)@([^/]+)(?:\/(.+))?$/);
		if (!match) continue;

		const [, name, ver, subPath] = match;
		const entry: { name: string; version: string; subPath?: string } = { name: name!, version: ver! };
		if (subPath) entry.subPath = subPath;
		mappings[url] = entry;
	}

	return mappings;
}

console.log(`
✅ Build complete!

📦 Output: ./npm/
📦 Extension packages: ./npm/extensions/

📋 Test locally:
   cd npm && npm link

   # In a test project:
   npm link veryfront

📋 Publish:
   cd npm && npm publish
`);
