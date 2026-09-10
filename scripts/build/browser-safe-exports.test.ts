import { assert, assertEquals } from "#std/assert";
import {
	BROWSER_SAFE_CLIENT_MODULES,
	BROWSER_SAFE_DNT_TIMER_MODULES,
	BROWSER_SAFE_EXPORTS,
} from "./browser-safe-exports.mjs";

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
