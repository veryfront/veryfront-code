import { assertEquals, assertThrows } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
	npmDependencyRange,
	parseNpmImport,
	readDenoConfigSet,
} from "./npm-dependency-sources.ts";

describe("npm dependency source helpers", () => {
	it("parses npm import map entries", () => {
		assertEquals(parseNpmImport("npm:ws@8.21.0"), {
			name: "ws",
			version: "8.21.0",
		});
		assertEquals(parseNpmImport("npm:@kreuzberg/wasm@4.5.2/dist/pkg/kreuzberg_wasm.js"), {
			name: "@kreuzberg/wasm",
			version: "4.5.2",
		});
	});

	it("parses esm.sh import map entries", () => {
		assertEquals(parseNpmImport("https://esm.sh/@types/react@19.2.14?deps=csstype@3.2.3"), {
			name: "@types/react",
			version: "19.2.14",
		});
		assertEquals(parseNpmImport("https://esm.sh/tailwindcss@4.2.2/plugin"), {
			name: "tailwindcss",
			version: "4.2.2",
		});
	});

	it("derives npm ranges from import maps", () => {
		const configs = [{
			imports: {
				ws: "npm:ws@8.21.0",
				react: "https://esm.sh/react@19.2.4?target=es2022",
			},
		}];

		assertEquals(npmDependencyRange(configs, "ws"), "8.21.0");
		assertEquals(npmDependencyRange(configs, "react", ""), "19.2.4");
	});

	it("loads dependency sources from workspace deno configs", async () => {
		const rootConfig = JSON.parse(await Deno.readTextFile("deno.json"));
		const configs = await readDenoConfigSet(".", rootConfig);

		assertEquals(npmDependencyRange(configs, "@types/react"), "19.2.14");
		assertEquals(npmDependencyRange(configs, "@types/react-dom"), "19.2.3");
		assertEquals(npmDependencyRange(configs, "@kreuzberg/node"), "4.4.2");
		assertEquals(npmDependencyRange(configs, "better-sqlite3", ""), "9.6.0");
	});

	it("fails when an explicit npm dependency has no config source", () => {
		assertThrows(
			() => npmDependencyRange([{ imports: {} }], "ws"),
			Error,
			'Missing npm dependency source for "ws"',
		);
	});
});
