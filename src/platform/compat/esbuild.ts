export type { BuildOptions, BuildResult, TransformOptions, TransformResult } from "esbuild";

let esbuildModule: typeof import("esbuild") | null = null;

export async function getEsbuild(): Promise<typeof import("esbuild")> {
  if (esbuildModule) return esbuildModule;
  esbuildModule = await import("esbuild");
  return esbuildModule;
}

export async function transform(
  code: string,
  options?: import("esbuild").TransformOptions,
): Promise<import("esbuild").TransformResult> {
  const esbuild = await getEsbuild();
  return esbuild.transform(code, options);
}

export async function build(
  options: import("esbuild").BuildOptions,
): Promise<import("esbuild").BuildResult> {
  const esbuild = await getEsbuild();
  return esbuild.build(options);
}

export async function stop(): Promise<void> {
  const esbuild = await getEsbuild();
  esbuild.stop();
}
