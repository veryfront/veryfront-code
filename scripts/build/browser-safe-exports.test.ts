import { assert, assertEquals } from "#std/assert";
import {
	BROWSER_SAFE_CLIENT_MODULES,
	BROWSER_SAFE_DNT_TIMER_MODULES,
	BROWSER_SAFE_EXPORTS,
	BROWSER_SAFE_TRANSITIVE_EXPORTS,
	BROWSER_SAFE_TRANSITIVE_MODULES,
} from "./browser-safe-exports.mjs";

const builtNpmRoot = new URL("../../npm/esm/", import.meta.url);

function isMissingFile(error: unknown): boolean {
	return error instanceof Deno.errors.NotFound;
}

async function pathExists(path: string | URL): Promise<boolean> {
	try {
		await Deno.stat(path);
		return true;
	} catch (error) {
		if (isMissingFile(error)) return false;
		throw error;
	}
}

function builtSpecifierTarget(from: URL, specifier: string): URL | null {
	if (!specifier.startsWith(".")) return null;
	const base = new URL(specifier, from);
	if (/\.[cm]?js$/.test(base.pathname)) return base;
	return new URL(`${base.pathname}.js`, base);
}

function builtRelativePath(file: URL): string {
	return decodeURIComponent(file.href.slice(builtNpmRoot.href.length));
}

function moduleSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	const pattern = /(?:import|export)\s+(?:[^"';]+?\s+from\s+)?["']([^"']+)["']|import\(["']([^"']+)["']\)/g;
	for (const match of source.matchAll(pattern)) {
		specifiers.push(match[1] ?? match[2]);
	}
	return specifiers;
}

async function collectBuiltDntImporters(entry: URL): Promise<string[]> {
	const queue: URL[] = [entry];
	const visited = new Set<string>();
	const importers = new Set<string>();

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || visited.has(current.href)) continue;
		visited.add(current.href);
		if (!current.href.startsWith(builtNpmRoot.href)) continue;
		if (!(await pathExists(current))) continue;

		const source = await Deno.readTextFile(current);
		if (source.includes("_dnt.polyfills.js") || source.includes("_dnt.shims.js")) {
			importers.add(builtRelativePath(current));
		}

		for (const specifier of moduleSpecifiers(source)) {
			const target = builtSpecifierTarget(current, specifier);
			if (target !== null && !visited.has(target.href)) {
				queue.push(target);
			}
		}
	}

	return [...importers].toSorted();
}

async function browserSafeExportBuiltEntry(exportPath: string): Promise<URL> {
	const denoJson = JSON.parse(await Deno.readTextFile(new URL("../../deno.json", import.meta.url)));
	const exports = denoJson.exports as Record<string, string>;
	const sourcePath = exports[exportPath];
	if (!sourcePath) {
		throw new Error(`Missing deno.json export for ${exportPath}`);
	}
	return new URL(
		sourcePath.replace(/^\.\//, "").replace(/\.tsx?$/, ".js"),
		builtNpmRoot,
	);
}

// build-npm-dnt.ts postBuild throws "Missing browser-safe export source" when
// an entry here no longer exists in deno.json exports — but only at release
// time. This test surfaces the drift in PR CI instead (broke release 0.1.761
// after #2350 demoted six chat exports without updating this list).
Deno.test("every BROWSER_SAFE_EXPORTS entry is a deno.json export", async () => {
	const denoJson = JSON.parse(await Deno.readTextFile("./deno.json"));
	const exports = denoJson.exports as Record<string, string>;

	const stale = BROWSER_SAFE_EXPORTS.filter((entry: string) => !exports[entry]);
	assert(
		stale.length === 0,
		`Stale BROWSER_SAFE_EXPORTS entries with no matching deno.json export: ${stale.join(", ")}`,
	);
});

Deno.test("every browser-safe module path points at an existing source file", async () => {
	const missing: string[] = [];
	for (const builtPath of [...BROWSER_SAFE_CLIENT_MODULES, ...BROWSER_SAFE_DNT_TIMER_MODULES]) {
		const sourcePath = (builtPath as string).replace(/\.js$/, ".ts");
		try {
			await Deno.stat(sourcePath);
		} catch {
			try {
				await Deno.stat(`${sourcePath}x`); // .tsx
			} catch {
				missing.push(builtPath as string);
			}
		}
	}
	assert(
		missing.length === 0,
		`Browser-safe module paths with no matching source file: ${missing.join(", ")}`,
	);
});


Deno.test("browser-safe transitive modules point at existing source files", async () => {
	const missing: string[] = [];
	for (const builtPath of BROWSER_SAFE_TRANSITIVE_MODULES) {
		const sourcePath = (builtPath as string).replace(/\.js$/, ".ts");
		if (!(await pathExists(sourcePath)) && !(await pathExists(`${sourcePath}x`))) {
			missing.push(builtPath as string);
		}
	}
	assert(
		missing.length === 0,
		`Browser-safe transitive module paths with no matching source file: ${missing.join(", ")}`,
	);
});

Deno.test("built browser-safe exports do not reach unstripped dnt imports", async () => {
	if (!(await pathExists(builtNpmRoot))) {
		console.log("Skipping built npm graph assertion because npm/esm has not been generated");
		return;
	}

	const plannedStrippedModules = new Set(BROWSER_SAFE_TRANSITIVE_MODULES as string[]);
	for (const exportPath of BROWSER_SAFE_TRANSITIVE_EXPORTS as string[]) {
		const entry = await browserSafeExportBuiltEntry(exportPath);
		const importers = await collectBuiltDntImporters(entry);
		const plannedDirectImporter = builtRelativePath(entry);
		const unplannedImporters = importers.filter((importer) => {
			return importer !== plannedDirectImporter && !plannedStrippedModules.has(importer);
		});
		assertEquals(
			unplannedImporters,
			[],
			`${exportPath} reaches dnt shim/polyfill imports that postBuild does not strip`,
		);
	}
});

Deno.test("browser-safe client modules include runtime shims reached by browser entrypoints", () => {
	for (
		const builtPath of [
			"src/react/runtime/core.js",
			"src/react/components/ui/color-mode.js",
		]
	) {
		assert(
			BROWSER_SAFE_CLIENT_MODULES.includes(builtPath),
			`${builtPath} must have dnt shim imports stripped for browser-safe npm entrypoints`,
		);
	}
});

Deno.test("browser error adapters do not retain Node imports", async () => {
	const output = await new Deno.Command(Deno.execPath(), {
		args: [
			"bundle",
			"--platform=browser",
			"--no-check",
			"src/agent/react/use-agent.ts",
		],
		cwd: new URL("../../", import.meta.url),
		stdin: "null",
		stdout: "piped",
		stderr: "piped",
	}).output();
	const stderr = new TextDecoder().decode(output.stderr);
	assert(output.success, `browser bundle failed:\n${stderr}`);

	const bundle = new TextDecoder().decode(output.stdout);
	assert(
		!/["']node:/.test(bundle),
		"the useAgent browser bundle must not retain a Node builtin import",
	);
});

Deno.test("the public observability barrel does not eagerly import Node-only helpers", async () => {
	const output = await new Deno.Command(Deno.execPath(), {
		args: [
			"bundle",
			"--platform=browser",
			"--no-check",
			"src/observability/index.ts",
		],
		cwd: new URL("../../", import.meta.url),
		stdin: "null",
		stdout: "piped",
		stderr: "piped",
	}).output();
	const stderr = new TextDecoder().decode(output.stderr);
	assert(output.success, `observability browser bundle failed:\n${stderr}`);

	const bundle = new TextDecoder().decode(output.stdout);
	assert(
		!/\b(?:from|import)\s*["']node:v8["']/.test(bundle),
		"the public observability barrel must not retain a browser-eager node:v8 import",
	);
	assert(
		!/\b(?:from|import)\s*["']node:util\/types["']/.test(bundle),
		"the public observability barrel must not retain a browser-eager node:util/types import",
	);
});

Deno.test("the run events entry point retains no browser-unsafe Node builtin", async () => {
	const output = await new Deno.Command(Deno.execPath(), {
		args: [
			"bundle",
			"--platform=browser",
			"--no-check",
			"src/run-events/index.ts",
		],
		cwd: new URL("../../", import.meta.url),
		stdin: "null",
		stdout: "piped",
		stderr: "piped",
	}).output();
	const stderr = new TextDecoder().decode(output.stderr);
	assert(output.success, `run events browser bundle failed:\n${stderr}`);

	const bundle = new TextDecoder().decode(output.stdout);
	const builtins = [...new Set(bundle.match(/["']node:[a-z_/]+/g) ?? [])]
		.map((match: string) => match.slice(1))
		.toSorted();

	// `node:async_hooks` arrives through the contract registry, which every
	// schema-carrying export reaches: `#veryfront/extensions/contracts.ts` ->
	// `contract-registry-internal.ts` -> `platform/compat/async-context.ts`. The
	// registry constructs an AsyncLocalStorage at module scope, so the import is
	// eager and cannot be dropped from a consumer. Veryfront's import rewriter
	// maps it to a no-op browser polyfill
	// (`src/transforms/import-rewriter/strategies/node-builtin-strategy.ts`), and
	// `./chat` and `./chat/ag-ui` ship with the same residual today. Pinning the
	// exact set here keeps a genuinely browser-unsafe builtin (`node:fs`,
	// `node:process`, and the rest) from reaching the browser through this entry
	// point unnoticed.
	assertEquals(
		builtins,
		["node:async_hooks"],
		"veryfront/run-events must reach no Node builtin beyond the contract registry's async_hooks",
  );
});

Deno.test("the agent events entry point retains no Node builtin", async () => {
	const output = await new Deno.Command(Deno.execPath(), {
		args: [
			"bundle",
			"--platform=browser",
			"--no-check",
			"src/events/index.ts",
		],
		cwd: new URL("../../", import.meta.url),
		stdin: "null",
		stdout: "piped",
		stderr: "piped",
	}).output();
	const stderr = new TextDecoder().decode(output.stderr);
	assert(output.success, `agent events browser bundle failed:\n${stderr}`);

	const bundle = new TextDecoder().decode(output.stdout);
	const builtins = [...new Set(bundle.match(/["']node:[a-z_/]+/g) ?? [])]
		.map((match: string) => match.slice(1))
		.toSorted();

	assertEquals(
		builtins,
		[],
		"veryfront/events must not retain Node builtin imports",
	);
});
