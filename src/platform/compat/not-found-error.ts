import { isDeno } from "./runtime.ts";

type DenoGlobal = typeof globalThis & {
  Deno?: {
    errors?: {
      NotFound?: new (...args: unknown[]) => Error;
    };
  };
};

/**
 * Return whether an error or its cause chain represents a path that cannot be
 * resolved. ENOTDIR is included because a missing candidate beneath a file is
 * just as absent as an ENOENT candidate during filesystem lookup.
 */
export function isNotFoundError(error: unknown, seen: Set<unknown> = new Set()): boolean {
  if (seen.has(error)) return false;
  seen.add(error);

  try {
    const NotFound = (globalThis as DenoGlobal).Deno?.errors?.NotFound;
    if (isDeno && NotFound && error instanceof NotFound) return true;
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return true;

    if (error instanceof Error) {
      if (
        error.name === "VeryfrontError" &&
        (error as { slug?: string }).slug === "file-not-found"
      ) {
        return true;
      }

      const legacyContext = (error as Error & { context?: unknown }).context;
      if (
        error.name === "VeryfrontError[file]" &&
        typeof legacyContext === "object" &&
        legacyContext !== null &&
        (legacyContext as { type?: unknown }).type === "file" &&
        typeof (legacyContext as { message?: unknown }).message === "string" &&
        /^(?:File|Path) not found:/.test(
          (legacyContext as { message: string }).message,
        )
      ) {
        return true;
      }

      if ("cause" in error) return isNotFoundError(error.cause, seen);
    }
  } catch {
    // Error classifiers must not replace the original filesystem failure.
  }

  return false;
}
