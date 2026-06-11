import { assert } from "#std/assert";
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
