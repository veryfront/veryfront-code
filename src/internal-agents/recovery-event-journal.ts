import { slicePrivateArray } from "#veryfront/security/private-array.ts";
const safeInteger = Number.isSafeInteger;
import { getConversationRunEventSchema } from "#veryfront/agent/conversation/run-events.ts";
import { snapshotDurableValue } from "./durable-run-home-schema.ts";
import { DurableRunHome, type DurableRunRecord } from "./durable-run-home.ts";

/** Persist-before-publish event suffix primitive; does not authorize a runtime generation. */
export class RecoveryEventJournal {
  constructor(private readonly home: DurableRunHome) {}

  async append(input: { sequence: number; event: unknown }): Promise<void> {
    await this.home.append({
      sequence: input.sequence,
      value: getConversationRunEventSchema().parse(snapshotDurableValue(input.event)),
    });
  }

  async suffix(afterSequence: number): Promise<DurableRunRecord[]> {
    if (!safeInteger(afterSequence) || afterSequence < 0) {
      throw new Error("Invalid recovery event cursor");
    }
    const records = await this.home.read();
    if (afterSequence > records.length) {
      throw new Error("Recovery event cursor is ahead of durable output");
    }
    return slicePrivateArray(records, afterSequence);
  }
}
