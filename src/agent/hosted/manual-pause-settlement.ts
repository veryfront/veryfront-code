import type { ConversationRunMirrorSnapshot } from "../conversation/run-mirror.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { getHostedAgentPauseCreationOptions } from "./manual-pause-credential.ts";
import { isAgentManualPauseBoundary } from "../runtime/manual-pause.ts";

type Settlement = {
  flushed: boolean;
  cleaned: boolean;
  failed: boolean;
  eligible: () => boolean;
  confirm: () => Promise<"confirmed" | "retry" | "rejected">;
};
const settlements = createPrivateWeakStore<object, Settlement>();
const schedule = setTimeout;
const NativePromise = Promise;

export function registerHostedAgentPauseSettlement(
  capability: object,
  eligible: Settlement["eligible"],
  confirm: Settlement["confirm"],
): void {
  settlements.set(capability, { flushed: false, cleaned: false, failed: false, eligible, confirm });
}

function stateFor(target: unknown): Settlement | undefined {
  const capability = getHostedAgentPauseCreationOptions(target);
  return capability ? settlements.get(capability) : undefined;
}

export function recordHostedAgentPauseFlush(target: unknown, succeeded: boolean): void {
  const state = stateFor(target);
  if (!state) return;
  state.flushed ||= succeeded;
  state.failed ||= !succeeded;
}

export function recordHostedAgentPauseMirrorSnapshot(
  target: unknown,
  snapshot: ConversationRunMirrorSnapshot | undefined,
): void {
  recordHostedAgentPauseFlush(
    target,
    snapshot === undefined ||
      (!snapshot.disabled && snapshot.pendingEventCount === 0 && !snapshot.inFlight &&
        !snapshot.hasRetryTimer),
  );
}

export function recordHostedAgentPauseCleanup(target: unknown, succeeded: boolean): void {
  const state = stateFor(target);
  if (!state) return;
  state.cleaned ||= succeeded;
  state.failed ||= !succeeded;
}

export function invalidateHostedAgentPauseSettlement(target: unknown, error: unknown): void {
  const state = stateFor(target);
  if (state && !isAgentManualPauseBoundary(error)) state.failed = true;
}

export function canSettleHostedAgentPause(target: unknown): boolean {
  const state = stateFor(target);
  return state !== undefined && !state.failed && state.flushed && state.cleaned && state.eligible();
}

/** Called only after the original invocation and its owned session have ended. */
export async function settleHostedAgentPause(target: unknown): Promise<void> {
  const state = stateFor(target);
  if (!state || !canSettleHostedAgentPause(target)) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!canSettleHostedAgentPause(target)) return;
    const result = await state.confirm();
    if (result !== "retry") return;
    if (attempt < 4) await new NativePromise<void>((resolve) => schedule(resolve, 100));
  }
  // An unknown reply leaves the durable acknowledgement fenced for lease recovery.
}
