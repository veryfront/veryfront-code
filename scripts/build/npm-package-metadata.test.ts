import { assertEquals, assertStringIncludes } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
	BROWSER_SAFE_CLIENT_MODULES,
	BROWSER_SAFE_EXPORTS,
} from "./browser-safe-exports.mjs";
import { normalizeNpmPackageMetadata } from "./npm-package-metadata.ts";

describe("normalizeNpmPackageMetadata", () => {
	it("removes source files from the published npm file list", () => {
		const pkg = normalizeNpmPackageMetadata({
			files: ["esm", "script", "src", "bin", "README.md"],
		});

		assertEquals(pkg.files, ["esm", "script", "bin", "README.md"]);
	});

	it("keeps opt-in feature packages out of automatic npm installs", () => {
		const pkg = normalizeNpmPackageMetadata({
			dependencies: {
				"@kreuzberg/node": "^4.4.2",
				"@kreuzberg/wasm": "4.5.2",
				"@opentelemetry/api": "1.9.1",
				"@opentelemetry/sdk-node": "0.218.0",
				"zod": "4.3.6",
			},
			optionalDependencies: {
				"@huggingface/transformers": "^4.2.0",
			},
		});

		assertEquals(pkg.dependencies, { zod: "4.3.6" });
		assertEquals(pkg.optionalDependencies, {
			"@huggingface/transformers": "4.2.0",
		});
		assertEquals(pkg.peerDependencies, {
			"@kreuzberg/node": "^4.4.2",
			"@kreuzberg/wasm": "4.5.2",
			"@opentelemetry/api": "1.9.1",
			"@opentelemetry/sdk-node": "0.218.0",
			"better-sqlite3": ">=9.0.0",
		});
		assertEquals(pkg.peerDependenciesMeta, {
			"@kreuzberg/node": { optional: true },
			"@kreuzberg/wasm": { optional: true },
			"@opentelemetry/api": { optional: true },
			"@opentelemetry/sdk-node": { optional: true },
			"better-sqlite3": { optional: true },
		});
	});

	it("keeps auto-enabled sandbox shell extension packages installable at runtime", () => {
		const pkg = normalizeNpmPackageMetadata({
			dependencies: {
				"bash-tool": "1.3.16",
				"just-bash": "2.14.5",
				zod: "4.3.6",
			},
		});

		assertEquals(pkg.dependencies, { zod: "4.3.6" });
		assertEquals(pkg.optionalDependencies, {
			"bash-tool": "1.3.16",
			"just-bash": "2.14.5",
		});
		assertEquals(pkg.peerDependencies, {
			"better-sqlite3": ">=9.0.0",
		});
		assertEquals(pkg.peerDependenciesMeta, {
			"better-sqlite3": { optional: true },
		});
	});

	it("removes stale direct AI SDK metadata from automatic npm installs", () => {
		const pkg = normalizeNpmPackageMetadata({
			dependencies: {
				ai: "^6.0.0",
				zod: "4.3.6",
			},
		});

		assertEquals(pkg.dependencies, { zod: "4.3.6" });
		assertEquals(pkg.peerDependencies, {
			"better-sqlite3": ">=9.0.0",
		});
		assertEquals(pkg.peerDependenciesMeta, {
			"better-sqlite3": { optional: true },
		});
	});

	it("removes stale npm-only type dev dependencies", () => {
		const pkg = normalizeNpmPackageMetadata({
			devDependencies: {
				"@types/better-sqlite3": "^7.6.0",
				"@types/mime-types": "^2.1.0",
				"@types/ws": "^8.5.0",
				"@types/node": "^20.9.0",
			},
		});

		assertEquals(pkg.devDependencies, { "@types/node": "20.9.0" });
	});

	it("pins automatic npm dependency ranges while preserving peer compatibility ranges", () => {
		const pkg = normalizeNpmPackageMetadata({
			dependencies: {
				"@types/react": "^19.2.14",
				"@deno/shim-deno": "~0.18.0",
				zod: "4.3.6",
			},
			optionalDependencies: {
				"just-bash": "^2.14.5",
			},
			devDependencies: {
				"@types/node": "^20.9.0",
			},
			peerDependencies: {
				react: "^19.0.0",
			},
		});

		assertEquals(pkg.dependencies, {
			"@types/react": "19.2.14",
			"@deno/shim-deno": "0.18.0",
			zod: "4.3.6",
		});
		assertEquals(pkg.optionalDependencies, {
			"just-bash": "2.14.5",
		});
		assertEquals(pkg.devDependencies, {
			"@types/node": "20.9.0",
		});
		assertEquals(pkg.peerDependencies, {
			react: "^19.0.0",
			"better-sqlite3": ">=9.0.0",
		});
	});
});

describe("npm supply-chain policy", () => {
	it("exports Studio AG-UI package entrypoints", async () => {
		const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
		const exports = denoConfig.exports as Record<string, string>;

		assertEquals(exports["./chat/ag-ui"], "./src/chat/ag-ui.ts");
		assertEquals(exports["./chat/protocol"], "./src/chat/protocol.ts");
	});

	it("keeps browser-safe export patches aligned to public exports", async () => {
		const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
		const exports = denoConfig.exports as Record<string, string>;

		for (const exportPath of BROWSER_SAFE_EXPORTS) {
			assertEquals(
				typeof exports[exportPath],
				"string",
				`${exportPath} must exist in deno.json exports before the npm build patches it`,
			);
		}
	});

	it("lazy-loads auto-enabled sandbox shell dependencies for npm CLI startup", async () => {
		const source = await Deno.readTextFile("extensions/ext-sandbox-shell-tools/src/index.ts");

		assertEquals(source.includes('import("bash-tool")'), true);
		assertEquals(source.includes('from "bash-tool"'), false);
	});

	it("keeps workflow React hooks off the broad errors barrel", async () => {
		const hookSources = [
			"src/workflow/react/use-approval.ts",
			"src/workflow/react/use-workflow.ts",
			"src/workflow/react/use-workflow-list.ts",
			"src/workflow/react/use-workflow-start.ts",
		];

		for (const path of hookSources) {
			const source = await Deno.readTextFile(path);
			assertEquals(
				source.includes('from "#veryfront/errors"'),
				false,
				`${path} must not import the browser-unsafe errors barrel`,
			);
			assertStringIncludes(source, '#veryfront/errors/error-registry.ts');
		}
	});

	it("keeps workflow React hooks in the browser-safe npm patch set", () => {
		assertEquals(BROWSER_SAFE_EXPORTS.includes("./workflow"), false);
		assertEquals(BROWSER_SAFE_CLIENT_MODULES.includes("src/workflow/react/index.js"), true);
		assertEquals(
			BROWSER_SAFE_CLIENT_MODULES.includes("src/workflow/react/use-workflow-start.js"),
			true,
		);
	});

	it("normalizes dnt interval shims for browser-safe client modules", async () => {
		const source = await Deno.readTextFile("scripts/build/build-npm-dnt.ts");

		assertStringIncludes(source, 'replaceAll("dntShim.setInterval", "globalThis.setInterval")');
		assertStringIncludes(
			source,
			'replaceAll("dntShim.clearInterval", "globalThis.clearInterval")',
		);
	});

	it("keeps npm CLI agent workflow paths off the DNT Deno shim in real Deno", async () => {
		const generatedFiles = [
			"npm/esm/cli/commands/mcp/handler.js",
			"npm/esm/cli/commands/lint/handler.js",
			"npm/esm/cli/commands/test/handler.js",
			"npm/esm/cli/commands/serve/split-mode.js",
			"npm/esm/cli/shared/animation.js",
			"npm/esm/cli/utils/write-run-result.js",
			"npm/esm/src/platform/compat/stdin.js",
			"npm/esm/src/platform/compat/process/lifecycle.js",
		];

		for (const path of generatedFiles) {
			const source = await Deno.readTextFile(path);
			assertEquals(
				source.includes("dntShim.Deno.addSignalListener"),
				false,
				`${path} must use real globalThis.Deno for signal handlers`,
			);
			assertEquals(
				source.includes("dntShim.Deno.stdin"),
				false,
				`${path} must use real globalThis.Deno for stdin`,
			);
			assertEquals(
				source.includes("dntShim.Deno.stdout"),
				false,
				`${path} must use real globalThis.Deno for stdout`,
			);
			assertEquals(
				source.includes("dntShim.Deno.Command"),
				false,
				`${path} must use real globalThis.Deno or platform runCommand for subprocesses`,
			);
			assertEquals(
				source.includes("dntShim.Deno.env"),
				false,
				`${path} must use platform env helpers`,
			);
			assertEquals(
				source.includes("dntShim.Deno.connect"),
				false,
				`${path} must use real globalThis.Deno for TCP readiness checks`,
			);
		}
	});
});

describe("npm generated integration artifacts", () => {
	it("builds npm from regenerated integration metadata", async () => {
		const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
		const buildNpmTask = denoConfig.tasks?.["build:npm"];

		assertEquals(typeof buildNpmTask, "string");
		assertEquals(
			buildNpmTask.indexOf("scripts/build/generate-integrations-module.ts") <
				buildNpmTask.indexOf("scripts/build/build-npm-dnt.ts"),
			true,
		);
	});

	it("keeps the active Jira JQL search endpoint in the npm source artifact", async () => {
		const source = await Deno.readTextFile("src/integrations/_data.ts");
		const urls = [...source.matchAll(/"url":\s*"([^"]+)"/g)].map((match) =>
			match[1]
		);

		assertEquals(
			urls.includes(
				"https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/search/jql",
			),
			true,
		);
		assertStringIncludes(source, '"nextPageToken"');
		assertEquals(
			urls.includes(
				"https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/search",
			),
			false,
		);
	});

	it("publishes README banner assets with the npm package", async () => {
		const source = await Deno.readTextFile("scripts/build/build-npm-dnt.ts");

		assertStringIncludes(
			source,
			'await Deno.copyFile("./assets/banner.svg", "./npm/assets/banner.svg");',
		);
		assertStringIncludes(
			source,
			'pkg.files = ["esm", "script", "bin", "assets", "tsconfig.json", "LICENSE", "README.md"];',
		);
	});
});
