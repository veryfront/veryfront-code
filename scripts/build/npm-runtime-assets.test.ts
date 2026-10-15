import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { copyNpmRuntimeAssets } from "./npm-runtime-assets.ts";
import { getSourceModuleRuntimeUrl } from "../../src/transforms/shared/source-module-location.ts";
import { fromFileUrl, toFileUrl } from "#std/path";

describe("emitted native runtime assets", () => {
	it("loads source metadata from the published package layout on Node", async () => {
		const directory = await Deno.makeTempDir({ prefix: "sdk-runtime-assets-" });
		try {
			await copyNpmRuntimeAssets(directory);
			await Deno.symlink(
				fromFileUrl(new URL("../../node_modules", import.meta.url)),
				`${directory}/node_modules`,
				{ type: "dir" },
			);
			await Deno.writeTextFile(`${directory}/template.html`, "asset");
			await Deno.writeTextFile(
				`${directory}/package.json`,
				JSON.stringify({
					type: "module",
					imports: { "#variant": { custom: "./custom.js", default: "./default.js" } },
				}),
			);
			await Deno.writeTextFile(`${directory}/custom.js`, "export {};\n");
			await Deno.writeTextFile(`${directory}/default.js`, "export {};\n");
			const sourceUrl = toFileUrl(`${directory}/page.js`).href;
			const runtimeUrl = getSourceModuleRuntimeUrl(
				toFileUrl(`${directory}/esm/src/transforms/shared/source-module-location.js`),
			);
			const peer = `${directory}/captured-react-dom`;
			await Deno.mkdir(peer);
			await Deno.writeTextFile(
				`${peer}/package.json`,
				JSON.stringify({
					name: "react-dom",
					type: "module",
					exports: { "./server.edge": "./edge.js" },
				}),
			);
			await Deno.writeTextFile(`${peer}/edge.js`, "export {};\n");
			const peers = { roots: { "react-dom": peer }, paths: {} };
			const code = `import { createSourceModuleMeta, prepareSourceModuleMeta } from ${
				JSON.stringify(runtimeUrl)
			}; await prepareSourceModuleMeta(${JSON.stringify(sourceUrl)}, ${
				JSON.stringify(peers)
			}); const meta = createSourceModuleMeta(import.meta, ${JSON.stringify(sourceUrl)}, ${
				JSON.stringify(peers)
			}); console.log(JSON.stringify({ url: meta.url, asset: meta.resolve('./template.html'), peer: meta.resolve('react-dom/server.edge') }));`;
			for (const useEnvironment of [false, true]) {
				const variantCode = code.replace(
					"asset: meta.resolve('./template.html')",
					"asset: meta.resolve('./template.html'), variant: meta.resolve('#variant')",
				);
				const output = await new Deno.Command("node", {
					args: [
						...(useEnvironment ? [] : ["--conditions=custom"]),
						"--input-type=module",
						"-e",
						variantCode,
					],
					env: useEnvironment
						? { NODE_OPTIONS: `${Deno.env.get("NODE_OPTIONS") ?? ""} --conditions=custom` }
						: {},
					stdout: "piped",
					stderr: "piped",
				}).output();
				assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
				assertEquals(JSON.parse(new TextDecoder().decode(output.stdout)), {
					url: sourceUrl,
					asset: toFileUrl(await Deno.realPath(`${directory}/template.html`)).href,
					variant: toFileUrl(await Deno.realPath(`${directory}/custom.js`)).href,
					peer: toFileUrl(await Deno.realPath(`${peer}/edge.js`)).href,
				});
			}
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	});
});
