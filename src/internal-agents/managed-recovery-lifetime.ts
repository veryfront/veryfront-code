import type { RecoverySessionOwner } from "./recovery-session-owner.ts";

const monotonicNow = performance.now.bind(performance);
const schedule = setTimeout;
const cancel = clearTimeout;

/** A blocked renewal never extends the last authenticated monotonic lease deadline. */
export async function startManagedRecoveryLifetime(
  owner: RecoverySessionOwner,
  abort: () => void,
): Promise<{ stop: () => void; assertCurrent: () => Promise<void> }> {
  let stopped = false;
  let deadline = 0;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let renewalTimer: ReturnType<typeof setTimeout> | undefined;
  const fail = () => {
    if (stopped) return;
    stopped = true;
    if (expiryTimer !== undefined) cancel(expiryTimer);
    if (renewalTimer !== undefined) cancel(renewalTimer);
    abort();
  };
  const renew = async () => {
    if (stopped) throw new Error("Managed recovery lifetime has ended");
    const started = monotonicNow();
    try {
      const receipt = await owner.assertCurrentOwnership();
      if (stopped) throw new Error("Managed recovery lifetime has ended");
      const remaining = receipt.leaseRemainingMs - (monotonicNow() - started);
      if (remaining <= 0) throw new Error("Managed recovery ownership budget expired");
      deadline = monotonicNow() + remaining;
      if (expiryTimer !== undefined) cancel(expiryTimer);
      if (renewalTimer !== undefined) cancel(renewalTimer);
      expiryTimer = schedule(fail, remaining);
      renewalTimer = schedule(() => {
        void renew().catch(fail);
      }, Math.min(1_000, remaining / 2));
    } catch (error) {
      fail();
      throw error;
    }
  };
  await renew();
  return {
    stop: () => {
      stopped = true;
      if (expiryTimer !== undefined) cancel(expiryTimer);
      if (renewalTimer !== undefined) cancel(renewalTimer);
    },
    assertCurrent: async () => {
      if (stopped || monotonicNow() >= deadline) {
        fail();
        throw new Error("Managed recovery ownership budget expired");
      }
      await renew();
    },
  };
}
