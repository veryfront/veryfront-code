export const ESBUILD_VERSION = "0.28.1";
export const ESBUILD_WASM_URL = `https://deno.land/x/esbuild@v${ESBUILD_VERSION}/esbuild.wasm`;

export function mapEsbuildArch(arch: string): string {
  const archMap: Record<string, string> = {
    x86_64: "x64",
    aarch64: "arm64",
  };
  return archMap[arch] ?? arch;
}

export function getEsbuildBinaryName(): string {
  return `@esbuild/${Deno.build.os}-${mapEsbuildArch(Deno.build.arch)}`;
}

export function getVFSBasePath(filePath: string, tempDir: string): string {
  const denoCompileMatch = filePath.match(/^(.*\/deno-compile-[^/]+)\//);
  if (denoCompileMatch?.[1]) return denoCompileMatch[1];

  const parts = filePath.split("/");
  const srcIndex = parts.lastIndexOf("src");
  if (srcIndex > 0) return parts.slice(0, srcIndex).join("/");

  return `${tempDir}/deno-compile-veryfront`;
}
