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

		assertEquals(pkg.devDependencies, { "@types/node": "^20.9.0" });
	});
});

describe("npm supply-chain policy", () => {
	it("statically loads auto-enabled sandbox shell dependencies for binary builds", async () => {
		const source = await Deno.readTextFile("extensions/ext-sandbox-shell-tools/src/index.ts");

		assertEquals(source.includes('from "bash-tool"'), true);
	});
});
