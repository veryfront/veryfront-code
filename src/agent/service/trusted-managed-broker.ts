import {
  createManagedExecutorBroker,
  type ManagedExecutorBrokerOptions,
  type ManagedExecutorStartInput,
} from "#veryfront/agent/hosted/managed-executor-broker.ts";
import { createTrustedManagedRuntime } from "#veryfront/agent/hosted/trusted-managed-runtime.ts";

/** Canonical project execution requires explicit project-tool and source-policy configuration. */
export type TrustedManagedExecutorStartInput = ManagedExecutorStartInput & {
  trustedRuntime: NonNullable<ManagedExecutorStartInput["trustedRuntime"]>;
};

type ManagedBroker = ReturnType<typeof createManagedExecutorBroker>;

/** Managed broker lifecycle with a required trusted-runtime start contract. */
export type TrustedManagedExecutorBroker = Omit<ManagedBroker, "start"> & {
  start(
    input: TrustedManagedExecutorStartInput,
    lifecycle?: Parameters<ManagedBroker["start"]>[1],
  ): ReturnType<ManagedBroker["start"]>;
};

/**
 * Construct a trusted agent-loop broker with project-tools-only executors.
 * Every start requires canonical fixed-project trustedRuntime configuration.
 * This process must never load or execute project-authored modules or callbacks.
 */
export function createTrustedManagedExecutorBroker(
  options: ManagedExecutorBrokerOptions,
): TrustedManagedExecutorBroker {
  return createManagedExecutorBroker(options, createTrustedManagedRuntime);
}
