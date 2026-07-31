/** Contracts for extension-owned skill execution implementations. */

export {
  type SkillScriptExecutionHandle,
  type SkillScriptExecutionReporter,
  type SkillScriptExecutorProvider,
  type SkillScriptExecutorProviderInput,
  SkillScriptExecutorProviderName,
  type SkillScriptExecutorProviderSnapshot,
  type SkillScriptPreparedExecution,
  snapshotSkillScriptExecutorProvider,
  snapshotSkillScriptPreparedExecution,
} from "./script-executor-provider.ts";
