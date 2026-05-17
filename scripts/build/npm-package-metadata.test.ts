import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
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
				"bash-tool": "1.3.16",
				"just-bash": "2.14.5",
				"zod": "4.3.6",
			},
			optionalDependencies: {
				"@huggingface/transformers": "^3.4.2",
			},
		});

		assertEquals(pkg.dependencies, { zod: "4.3.6" });
		assertEquals(pkg.optionalDependencies, {
			"@huggingface/transformers": "^3.4.2",
		});
		assertEquals(pkg.peerDependencies, {
			"@kreuzberg/node": "^4.4.2",
			"@kreuzberg/wasm": "4.5.2",
			"@opentelemetry/api": "1.9.1",
			"@opentelemetry/sdk-node": "0.218.0",
			"bash-tool": "1.3.16",
			"better-sqlite3": ">=9.0.0",
			"just-bash": "2.14.5",
		});
		assertEquals(pkg.peerDependenciesMeta, {
			"@kreuzberg/node": { optional: true },
			"@kreuzberg/wasm": { optional: true },
			"@opentelemetry/api": { optional: true },
			"@opentelemetry/sdk-node": { optional: true },
			"bash-tool": { optional: true },
			"better-sqlite3": { optional: true },
			"just-bash": { optional: true },
		});
	});
});

describe("npm supply-chain policy", () => {
	it("does not statically load the shell execution dependency at module import time", async () => {
		const source = await Deno.readTextFile("extensions/ext-sandbox-shell-tools/src/index.ts");

		assertEquals(source.includes('from "bash-tool"'), false);
	});
});
