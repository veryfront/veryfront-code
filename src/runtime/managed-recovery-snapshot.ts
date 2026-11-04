/**
 * Native data validation for version-one managed recovery snapshot envelopes.
 * This parser grants no execution authority. Configure the schema validator as
 * for other Veryfront native schema consumers before calling it.
 * @module runtime/managed-recovery-snapshot
 */
export {
  parseRecoverySnapshot as parseManagedRecoverySnapshotV1,
  type RecoverySnapshot as ManagedRecoverySnapshotV1,
} from "../internal-agents/recovery-snapshot.ts";
