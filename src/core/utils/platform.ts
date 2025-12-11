
import { isDeno } from "../../platform/compat/runtime.ts";
import { execPath } from "../../platform/compat/process.ts";

export function isCompiledBinary(): boolean {
  if (!isDeno) return false;

  try {
    const path = execPath();
    return path.includes("veryfront");
  } catch {
    return false;
  }
}
