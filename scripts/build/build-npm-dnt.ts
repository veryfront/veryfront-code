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
} from "./browser-safe-exports.mjs";
import {
	npmDependencyRange,
	readDenoConfigSet,
} from "./npm-dependency-sources.ts";
import { normalizeNpmPackageMetadata } from "./npm-package-metadata.ts";
import { normalizeEsmShReactNpmShims } from "./npm-react-shims.ts";
import { OPAQUE_DEPENDENCY_VERSIONS } from "../../src/platform/compat/opaque-dependency-versions.ts";

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
		timers: true,
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
		// Type-only packages - map to @types versions
		"npm:@types/mdast@4.0.3": {
			name: "@types/mdast",
			version: "^4.0.3",
		},
		"npm:@types/hast@3.0.3": {
			name: "@types/hast",
			version: "^3.0.3",
		},
		"npm:@types/unist@3.0.2": {
			name: "@types/unist",
			version: "^3.0.2",
		},
		// esm.sh URLs - derived from deno.json imports
		...esmShMappings,
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
			"@kreuzberg/node": npmDependencyRange(denoConfigSet, "@kreuzberg/node"),
		},
		// Native binary deps that should not block install if they fail
		optionalDependencies: {
			"@huggingface/transformers": OPAQUE_DEPENDENCY_VERSIONS["@huggingface/transformers"],
			// ext-sandbox-shell-tools is auto-enabled by the hosted agent service,
			// so its runtime implementation must be installable with the npm package.
			"bash-tool": npmDependencyRange(denoConfigSet, "bash-tool"),
			"just-bash": npmDependencyRange(denoConfigSet, "just-bash"),
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
		// Optional peer dependencies for platform-specific features
		peerDependencies: {
			"better-sqlite3": ">=9.0.0",
		},
		peerDependenciesMeta: {
			"better-sqlite3": { optional: true },
		},
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

		// Transpile the kreuzberg upload-extraction worker into the npm package.
		// It is spawned via `new Worker(new URL("./upload-extraction-worker.js"))`
		// (see extensions/ext-document-kreuzberg/src/index.ts), so dnt never traces
		// it as a static import and would otherwise omit it from the build. Strip
		// the TypeScript types and rewrite the sibling `./kreuzberg.ts` import to the
		// transpiled `./kreuzberg.js` that dnt emits next to it.
		const esbuild = await import("npm:esbuild@0.28.1");
		try {
			const workerSrc = "./extensions/ext-document-kreuzberg/src/upload-extraction-worker.ts";
			const workerDest =
				"./npm/esm/extensions/ext-document-kreuzberg/src/upload-extraction-worker.js";
			const transpiled = await esbuild.transform(await Deno.readTextFile(workerSrc), {
				loader: "ts",
				format: "esm",
				target: "esnext",
			});
			await Deno.writeTextFile(
				workerDest,
				transpiled.code.replaceAll("./kreuzberg.ts", "./kreuzberg.js"),
			);
			console.log("📝 Transpiled ext-document-kreuzberg upload-extraction worker");
		} finally {
			await esbuild.stop();
		}

		// Fix dnt polyfill bug: process.argv[1] can be undefined in dynamic imports
		patchFile(
			"./npm/esm/_dnt.polyfills.js",
			'process.argv[1].replace',
			'(process.argv[1] ?? "").replace',
			"dnt polyfill process.argv[1] fix",
		);

		const patchedReactShimCount = normalizeEsmShReactNpmShims("./npm/esm/deps/esm.sh");
		if (patchedReactShimCount > 0) {
			console.log(`📝 Patched ${patchedReactShimCount} React ecosystem esm.sh npm shims`);
		}

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
		pkg.type = "module"; // Required for ESM imports without warnings
		pkg.types = "./esm/src/index.d.ts";
		pkg.bin = { veryfront: "bin/veryfront.js" };
		pkg.files = ["esm", "script", "bin", "assets", "tsconfig.json", "LICENSE", "NOTICE", "README.md"];
		pkg.exports["./tsconfig.json"] = "./tsconfig.json";
		addTypesExportEntries(pkg.exports);
		normalizeNpmPackageMetadata(pkg);
		await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2));
	},
});

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

/** Patch a generated file with string or regex replacement. Throws if pattern not found. */
function patchFile(
	path: string,
	search: string | RegExp,
	replacement: string,
	description: string,
): void {
	const content = Deno.readTextFileSync(path);
	const patched = typeof search === "string"
		? content.replace(search, replacement)
		: content.replace(search, replacement);
	if (patched === content) {
		throw new Error(
			`Patch failed: "${description}" did not match anything in ${path}. ` +
				`dnt output may have changed — update the patch or remove it if the bug is fixed.`,
		);
	}
	Deno.writeTextFileSync(path, patched);
	console.log(`📝 Patched ${description} in ${path}`);
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

📋 Test locally:
   cd npm && npm link

   # In a test project:
   npm link veryfront

📋 Publish:
   cd npm && npm publish
`);
