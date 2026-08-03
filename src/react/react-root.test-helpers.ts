import { flushSync } from "react-dom";
import type { Root } from "react-dom/client";

/**
 * Unmount a React root and drain the scheduler task left by the commit.
 *
 * React may retain a pending scheduler callback after `Root.unmount()`. Tests
 * that use Deno's leak sanitizer must yield once before restoring their DOM
 * globals or returning.
 */
export async function unmountReactRoot(root: Root | undefined): Promise<void> {
  if (!root) return;
  flushSync(() => root.unmount());
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
