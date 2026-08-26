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
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ExtendedFileSystemAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { isHostProjectCodeExecutionAllowed } from "#veryfront/security/project-locality.ts";
import type { DiscoveryOptions } from "./production-server.ts";

export interface RunStartupDiscoveryInput {
  config: DiscoveryOptions;
  /** Host-owned runtime topology used to constrain the deployment grant. */
  runtimeAdapter: RuntimeAdapter;
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

/** What startup discovery did, so the caller can report it accurately. */
export type StartupDiscoveryOutcome =
  | { ran: true }
  | { ran: false; reason: "scoped-multi-project" };

export async function runStartupDiscovery(
  input: RunStartupDiscoveryInput,
): Promise<StartupDiscoveryOutcome> {
  const { config } = input;

  if (scopedAdapter(input)) {
    // Scoped to one project, so tenant source is in reach. This path stays
    // ungranted whatever the deployment's posture: the capability is for a
    // host-owned entrypoint evaluating its own project, not for discovery
    // running inside a tenant's context.
    //
    // `discoverAll` refuses an ungranted config by throwing, so an ungranted
    // call here cannot discover anything, it can only raise. Previously this
    // branch called it anyway inside `runWithContext`, and every scoped
    // multi-project startup logged "Primitive discovery failed" while the real
    // meaning was "this deployment does not run startup discovery". Skipping
    // is the same behaviour with an honest name and no exception as control
    // flow.
    return { ran: false, reason: "scoped-multi-project" };
  }

  await input.discoverAll({
    baseDir: config.baseDir,
    fsAdapter: config.fsAdapter,
    verbose: config.verbose ?? false,
    allowHostProjectCodeExecution: isHostProjectCodeExecutionAllowed({
      adapter: input.runtimeAdapter,
      allowHostProjectCodeExecution: input.allowHostProjectCodeExecution,
    }),
  });
  return { ran: true };
}
