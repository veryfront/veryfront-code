import type { WaitNodeConfig } from "./types.ts";

/** Reserved transport name used by legacy durable delay records. */
export const INTERNAL_DELAY_EVENT_NAME = "__delay__";

/** Internal discriminator captured in definitions and persisted wait state. */
export const INTERNAL_WAIT_KIND_FIELD = "_waitKind";

export type DurableTimedWaitKind = "delay" | "event";

type InternallyMarkedWaitConfig = WaitNodeConfig & {
  readonly [INTERNAL_WAIT_KIND_FIELD]?: DurableTimedWaitKind;
};

/** Read a captured definition marker, with legacy fallback for direct DAG callers. */
export function getConfiguredTimedWaitKind(
  config: WaitNodeConfig,
): DurableTimedWaitKind | undefined {
  if (config.waitType !== "event") return undefined;
  const marker = (config as InternallyMarkedWaitConfig)[INTERNAL_WAIT_KIND_FIELD];
  if (marker === "delay" || marker === "event") return marker;
  return config.eventName === INTERNAL_DELAY_EVENT_NAME ? "delay" : "event";
}
