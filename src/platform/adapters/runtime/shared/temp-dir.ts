import { validateTempDirectoryPrefix } from "../../../compat/temp-directory-prefix.ts";

export async function makeNodeTempDir(prefix: string): Promise<string> {
  const validatedPrefix = validateTempDirectoryPrefix(prefix);
  const { mkdtemp } = await import("node:fs/promises");
  const { sep } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const tempRoot = tmpdir();
  const rootPrefix = tempRoot.endsWith(sep) ? tempRoot : `${tempRoot}${sep}`;
  return await mkdtemp(`${rootPrefix}${validatedPrefix}`);
}
