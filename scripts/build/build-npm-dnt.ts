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
import {
	BROWSER_SAFE_CLIENT_MODULES,
	BROWSER_SAFE_DNT_TIMER_MODULES,
	BROWSER_SAFE_EXPORTS,
	BROWSER_SAFE_INTERNAL_ENTRY_POINTS,
	createDntEntryPoints,
} from "./browser-safe-exports.mjs";
import {
	npmDependencyRange,
	readDenoConfigSet,
} from "./npm-dependency-sources.ts";
import { buildExtensionPackages } from "./build-npm-extension-packages.ts";
import { patchDntArgvPolyfill } from "./dnt-polyfill.ts";
import {
	normalizeNpmPackageMetadata,
	removeInternalNpmEntryPointExports,
} from "./npm-package-metadata.ts";
import {
	assertNoBundledReactDomClientShim,
	normalizeEsmShReactNpmShims,
} from "./npm-react-shims.ts";

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
	args: ["run", "--frozen", "-A", "scripts/build/generate-templates-manifest.ts"],
	stdout: "inherit",
	stderr: "inherit",
});
const { code: manifestCode } = await genManifest.output();
if (manifestCode !== 0) {
	throw new Error("Failed to generate templates manifest");
}

await emptyDir("./npm");

// Convert deno.json exports to dnt entry points
const entryPoints = createDntEntryPoints(
	denoJson.exports as Record<string, string>,
	BROWSER_SAFE_INTERNAL_ENTRY_POINTS,
);

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
	// Node 18+ (our minimum engine) provides fetch/Headers/Response/Request/
	// FormData/File/Blob as globals natively, so no shim is needed.
	shims: {
		deno: true,
		// Node 18+ provides native timers. Keeping the dnt timer shim here turns
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
		//
		// `react-dom/client` is intentionally absent. Browser hydration imports are
		// prebundled separately and no npm entry point reaches the local client
		// shim. Dnt rejects package mappings that are not present in its module
		// graph, so retaining that stale mapping makes the npm build fail before
		// emission. The generated-package gates below fail closed if this local
		// shim becomes reachable and verify consumer-facing React declarations.
		"./react/react.ts": { name: "react", version: reactRange },
		"./react/react-dom.ts": { name: "react-dom", version: reactRange },
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
			node: ">=18.0.0",
		},
		// dnt can't detect dynamic imports, so we add them explicitly
		dependencies: {
			"@types/react": npmDependencyRange(denoConfigSet, "@types/react"),
			"@types/react-dom": npmDependencyRange(denoConfigSet, "@types/react-dom"),
			// Root deno.json intentionally rejects core npm imports; ws is a
			// Node-only dynamic import used by the npm server/HMR path.
			"ws": "8.21.0",
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

		const patchedReactShimCount = normalizeEsmShReactNpmShims("./npm/esm/deps/esm.sh");
		if (patchedReactShimCount > 0) {
			console.log(`📝 Patched ${patchedReactShimCount} React ecosystem esm.sh npm shims`);
		}
		assertNoBundledReactDomClientShim("./npm/esm");

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
		const internalEntryPoints: Readonly<Record<string, string>> =
			BROWSER_SAFE_INTERNAL_ENTRY_POINTS;
		for (const exportPath of [...BROWSER_SAFE_EXPORTS, ...Object.keys(internalEntryPoints)]) {
			const sourcePath = (denoJson.exports as Record<string, string>)[exportPath] ??
				internalEntryPoints[exportPath];
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
				assertNoDntRuntimeImports(
					path,
					`${exportPath} browser-safe artifact`,
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

		// Note: Templates are now embedded in manifest.json which is bundled by dnt
		// No need to copy template files separately

		// Copy bin wrapper
		await Deno.mkdir("./npm/bin", { recursive: true });
		await Deno.copyFile("./scripts/build/bin-wrapper.js", "./npm/bin/veryfront.js");
		await Deno.chmod("./npm/bin/veryfront.js", 0o755);

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
		removeInternalNpmEntryPointExports(
			pkg,
			Object.keys(BROWSER_SAFE_INTERNAL_ENTRY_POINTS),
		);
		pkg.type = "module"; // Required for ESM imports without warnings
		pkg.types = "./esm/src/index.d.ts";
		pkg.bin = { veryfront: "bin/veryfront.js" };
		pkg.dependencies ??= {};
		// Add after build-local npm install so releases do not require the
		// just-built auto-loaded extension versions to already exist in the registry.
		pkg.dependencies["@veryfront/ext-bundler-esbuild"] = version;
		pkg.dependencies["@veryfront/ext-content-mdx"] = version;
		pkg.dependencies["@veryfront/ext-css-tailwind"] = version;
		// ext-parser-babel provides the CodeParser contract that `veryfront serve`
		// needs to vet client-page modules for /_veryfront/rsc/module hydration;
		// without it the endpoint 404s and client pages render without hydrating.
		pkg.dependencies["@veryfront/ext-parser-babel"] = version;
		pkg.files = ["esm", "script", "bin", "assets", "tsconfig.json", "LICENSE", "NOTICE", "README.md"];
		pkg.exports["./tsconfig.json"] = "./tsconfig.json";
		addTypesExportEntries(pkg.exports);
		normalizeNpmPackageMetadata(pkg);
		await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2));

		const writtenPkg = JSON.parse(await Deno.readTextFile(pkgPath));
		for (const entryPoint of Object.keys(BROWSER_SAFE_INTERNAL_ENTRY_POINTS)) {
			if (Object.hasOwn(writtenPkg.exports ?? {}, entryPoint)) {
				throw new Error(
					`Published npm metadata still exposes internal entry point ${entryPoint}`,
				);
			}
		}
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
	const timeoutMs = 10_000;
	const child = new Deno.Command("node", {
		args: [
			"--input-type=module",
			"--eval",
			'const mod = await import("./esm/src/index.js"); if (typeof mod.defineConfig !== "function") throw new Error("defineConfig export missing");',
		],
		cwd: "./npm",
		env: { VF_DISABLE_LRU_INTERVAL: "0" },
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

	console.log("✅ Verified npm root import lifecycle");
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

function assertNoDntRuntimeImports(path: string, description: string): void {
	const content = Deno.readTextFileSync(path);
	const forbiddenReferences = ["_dnt.polyfills", "_dnt.shims"]
		.filter((reference) => content.includes(reference));
	if (forbiddenReferences.length > 0) {
		throw new Error(
			`${description} at ${path} still references ${forbiddenReferences.join(", ")}`,
		);
	}
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
