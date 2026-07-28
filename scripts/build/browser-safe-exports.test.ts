import { assert, assertThrows } from "#std/assert";
import {
	BROWSER_SAFE_CLIENT_MODULES,
	BROWSER_SAFE_DNT_TIMER_MODULES,
	BROWSER_SAFE_EXPORTS,
	BROWSER_SAFE_INTERNAL_ENTRY_POINTS,
	createDntEntryPoints,
	NPM_INTERNAL_ENTRY_POINTS,
} from "./browser-safe-exports.mjs";

Deno.test("ships browser-only internal entry points without exposing public package subpaths", async () => {
	const denoJson = JSON.parse(await Deno.readTextFile("./deno.json"));
	const exports = denoJson.exports as Record<string, string>;
	const imports = denoJson.imports as Record<string, string>;

	assert(exports["./index.client"] === undefined);
	assert(exports["./react/public"] === undefined);
	assert(imports["veryfront/index.client"] === "./src/index.client.ts");
	assert(
		BROWSER_SAFE_INTERNAL_ENTRY_POINTS["./index.client"] ===
			"./src/index.client.ts",
	);
	assert(
		BROWSER_SAFE_INTERNAL_ENTRY_POINTS["./react/public"] ===
			"./src/react/public.ts",
	);
	assert(
		NPM_INTERNAL_ENTRY_POINTS["./react/public"] ===
			"./src/react/public.ts",
	);
	assert(
		NPM_INTERNAL_ENTRY_POINTS["./config/declarative-evaluator"] ===
			"./src/config/declarative-evaluator.ts",
	);
	assert(
		NPM_INTERNAL_ENTRY_POINTS["./config/declarative-evaluator-worker-entry"] ===
			"./src/config/declarative-evaluator-worker-entry.ts",
	);
	assert(
		NPM_INTERNAL_ENTRY_POINTS["./config/declarative-evaluator-worker-runner"] ===
			"./src/config/declarative-evaluator-worker-runner.ts",
	);
	assert(
		!Object.hasOwn(
			BROWSER_SAFE_INTERNAL_ENTRY_POINTS,
			"./config/declarative-evaluator",
		),
	);
});

Deno.test("rejects overlap between public and build-only entry points", () => {
	assertThrows(
		() =>
			createDntEntryPoints(
				{ "./index.client": "./src/public-client.ts" },
				NPM_INTERNAL_ENTRY_POINTS,
			),
		Error,
		"both public and internal",
	);
});

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
