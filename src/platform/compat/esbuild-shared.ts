export const ESBUILD_VERSION = "0.28.1";

export interface EsbuildBuildTarget {
  arch: string;
  os: string;
}

export function getEsbuildBinaryName(build: EsbuildBuildTarget = Deno.build): string {
  const archMap: Record<string, string> = {
    x86_64: "x64",
    aarch64: "arm64",
  };
  const esbuildArch = archMap[build.arch] ?? build.arch;
  return `@esbuild/${build.os}-${esbuildArch}`;
}

export function getVFSBasePath(filePath: string, tempDir: string): string {
  const normalizedFilePath = filePath.replaceAll("\\", "/");
  const normalizedTempDir = tempDir.replaceAll("\\", "/").replace(/\/+$/, "");
  const denoCompileMatch = normalizedFilePath.match(/^(.*\/deno-compile-[^/]+)\//);
  if (denoCompileMatch?.[1]) return denoCompileMatch[1];

  const parts = normalizedFilePath.split("/");
  const srcIndex = parts.lastIndexOf("src");
  if (srcIndex > 0) return parts.slice(0, srcIndex).join("/");

  const tempRoot = normalizedTempDir || "/";
  return tempRoot === "/" ? "/deno-compile-veryfront" : `${tempRoot}/deno-compile-veryfront`;
}
