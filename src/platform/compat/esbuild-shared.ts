export const ESBUILD_VERSION = "0.20.2";

export function getEsbuildBinaryName(): string {
  const archMap: Record<string, string> = {
    x86_64: "x64",
    aarch64: "arm64",
  };
  const esbuildArch = archMap[Deno.build.arch] ?? Deno.build.arch;
  return `@esbuild/${Deno.build.os}-${esbuildArch}`;
}

export function getVFSBasePath(filePath: string, tempDir: string): string {
  const denoCompileMatch = filePath.match(/^(.*\/deno-compile-[^/]+)\//);
  if (denoCompileMatch?.[1]) return denoCompileMatch[1];

  const parts = filePath.split("/");
  const srcIndex = parts.lastIndexOf("src");
  if (srcIndex > 0) return parts.slice(0, srcIndex).join("/");

  return `${tempDir}/deno-compile-veryfront`;
}
