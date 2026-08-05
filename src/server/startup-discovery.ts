/**
 * Primitive discovery run once at startup, before the server accepts requests.
 *
 * Extracted from `production-server.ts` so the host-execution grant it passes
 * can be tested. The bug this addresses (issue-inbox#363) was that the fallback
 * branch hardcoded `allowHostProjectCodeExecution: true` while the request
 * handler computed the real answer fifteen lines below, so a deployment that
 * denied execution at request time still granted it at startup.
 *
 * Same shape as veryfront-code#3364, where `api-handler-wrapper.ts` passed a
 * hardcoded `true` and made the computed predicate dead code. A hardcoded
 * capability sitting next to a computed one is the pattern to look for.
 */

import type { DiscoveryConfig, DiscoveryResult } from "#veryfront/discovery/types.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ExtendedFileSystemAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { DiscoveryOptions } from "./production-server.ts";

export interface RunStartupDiscoveryInput {
  config: DiscoveryOptions;
  /**
   * The deployment's posture, computed once by the host-owned entrypoint and
   * shared with the request handler. Never hardcoded here.
   */
  allowHostProjectCodeExecution: boolean;
  discoverAll: (config: DiscoveryConfig) => Promise<DiscoveryResult>;
  isExtendedFSAdapter: (fs: FileSystemAdapter) => fs is ExtendedFileSystemAdapter;
}

/** Whether discovery can be scoped to one project on a multi-project adapter. */
function scopedAdapter(
  input: RunStartupDiscoveryInput,
): ExtendedFileSystemAdapter | undefined {
  const { config } = input;
  if (!config.projectSlug || !config.apiToken || !config.fsAdapter) return undefined;
  if (!input.isExtendedFSAdapter(config.fsAdapter)) return undefined;
  return config.fsAdapter.isMultiProjectMode() ? config.fsAdapter : undefined;
}

export async function runStartupDiscovery(input: RunStartupDiscoveryInput): Promise<void> {
  const { config } = input;
  const base = {
    baseDir: config.baseDir,
    fsAdapter: config.fsAdapter,
    verbose: config.verbose ?? false,
  };

  const adapter = scopedAdapter(input);
  if (adapter) {
    // Scoped to one project, so tenant source is in reach. This path stays
    // ungranted whatever the deployment's posture: the capability is for a
    // host-owned entrypoint evaluating its own project, not for discovery
    // running inside a tenant's context.
    await adapter.runWithContext(
      config.projectSlug as string,
      config.apiToken as string,
      () => input.discoverAll(base),
    );
    return;
  }

  await input.discoverAll({
    ...base,
    allowHostProjectCodeExecution: input.allowHostProjectCodeExecution,
  });
}
