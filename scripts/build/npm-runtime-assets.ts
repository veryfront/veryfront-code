/** Assets loaded by file URL from emitted SDK modules, outside DNT's module graph. */
export async function copyNpmRuntimeAssets(outputDirectory: string): Promise<void> {
	const folder = `${outputDirectory}/esm/src/transforms/shared`;
	await Deno.mkdir(folder, { recursive: true });
	for (const name of ["source-module-runtime.mjs", "source-module-resolver-hooks.mjs"]) {
		await Deno.copyFile(
			new URL(`../../src/transforms/shared/${name}`, import.meta.url),
			`${folder}/${name}`,
		);
	}
}
