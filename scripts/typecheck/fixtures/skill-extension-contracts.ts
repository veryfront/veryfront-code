import {
  type SkillScriptExecutionHandle as RootSkillScriptExecutionHandle,
  type SkillScriptExecutionReporter as RootSkillScriptExecutionReporter,
  type SkillScriptExecutorProvider as RootSkillScriptExecutorProvider,
  type SkillScriptExecutorProviderInput as RootSkillScriptExecutorProviderInput,
  SkillScriptExecutorProviderName as RootSkillScriptExecutorProviderName,
  type SkillScriptExecutorProviderSnapshot
    as RootSkillScriptExecutorProviderSnapshot,
  type SkillScriptPreparedExecution as RootSkillScriptPreparedExecution,
  snapshotSkillScriptExecutorProvider
    as snapshotRootSkillScriptExecutorProvider,
  snapshotSkillScriptPreparedExecution
    as snapshotRootSkillScriptPreparedExecution,
} from "veryfront/extensions";
import {
  type SkillScriptExecutionHandle as DeepSkillScriptExecutionHandle,
  type SkillScriptExecutionReporter as DeepSkillScriptExecutionReporter,
  type SkillScriptExecutorProvider as DeepSkillScriptExecutorProvider,
  type SkillScriptExecutorProviderInput as DeepSkillScriptExecutorProviderInput,
  SkillScriptExecutorProviderName as DeepSkillScriptExecutorProviderName,
  type SkillScriptExecutorProviderSnapshot
    as DeepSkillScriptExecutorProviderSnapshot,
  type SkillScriptPreparedExecution as DeepSkillScriptPreparedExecution,
  snapshotSkillScriptExecutorProvider
    as snapshotDeepSkillScriptExecutorProvider,
  snapshotSkillScriptPreparedExecution
    as snapshotDeepSkillScriptPreparedExecution,
} from "veryfront/extensions/skill";
import {
  type SkillScriptResult,
  snapshotSkillScriptResult,
} from "veryfront/skill";

class ProviderScriptResult implements SkillScriptResult {
  readonly traceId = "trace-1";

  constructor(
    public stdout: string,
    public stderr: string,
    public exitCode: number,
  ) {}
}

const structuralResult: SkillScriptResult = new ProviderScriptResult(
  "done",
  "",
  0,
);
const detachedStructuralResult: Readonly<SkillScriptResult> =
  snapshotSkillScriptResult(
    new ProviderScriptResult("snapshotted", "", 0),
  );

const rootProvider: RootSkillScriptExecutorProvider = {
  prepare(input, reporter) {
    const deepInput: Readonly<DeepSkillScriptExecutorProviderInput> = input;
    const deepReporter: Readonly<DeepSkillScriptExecutionReporter> = reporter;
    void deepInput;

    return {
      activate() {
        deepReporter.resolveResult(new ProviderScriptResult("root", "", 0));
        deepReporter.resolveTerminal();
      },
      terminate(reason?: unknown) {
        deepReporter.rejectResult(reason);
        deepReporter.rejectTerminal(reason);
      },
    } satisfies RootSkillScriptPreparedExecution;
  },
};

const deepProvider: DeepSkillScriptExecutorProvider = {
  prepare(input, reporter) {
    const rootInput: Readonly<RootSkillScriptExecutorProviderInput> = input;
    const rootReporter: Readonly<RootSkillScriptExecutionReporter> = reporter;
    void rootInput;

    return {
      activate() {
        rootReporter.resolveResult(new ProviderScriptResult("deep", "", 0));
        rootReporter.resolveTerminal();
      },
      terminate(reason?: unknown) {
        rootReporter.rejectResult(reason);
        rootReporter.rejectTerminal(reason);
      },
    } satisfies DeepSkillScriptPreparedExecution;
  },
};

const rootPrepared: Readonly<RootSkillScriptPreparedExecution> =
  snapshotRootSkillScriptPreparedExecution({
    activate() {},
    terminate(_reason?: unknown) {},
  });
const deepPrepared: Readonly<DeepSkillScriptPreparedExecution> =
  snapshotDeepSkillScriptPreparedExecution({
    activate() {},
    terminate(_reason?: unknown) {},
  });

const rootProviderSnapshot: Readonly<RootSkillScriptExecutorProviderSnapshot> =
  snapshotRootSkillScriptExecutorProvider(rootProvider);
const deepProviderSnapshot: Readonly<DeepSkillScriptExecutorProviderSnapshot> =
  snapshotDeepSkillScriptExecutorProvider(deepProvider);

const rootProviderAsDeep: DeepSkillScriptExecutorProvider = rootProvider;
const deepProviderAsRoot: RootSkillScriptExecutorProvider = deepProvider;
const rootPreparedAsDeep: Readonly<DeepSkillScriptPreparedExecution> =
  rootPrepared;
const deepPreparedAsRoot: Readonly<RootSkillScriptPreparedExecution> =
  deepPrepared;
const rootSnapshotAsDeep: Readonly<DeepSkillScriptExecutorProviderSnapshot> =
  rootProviderSnapshot;
const deepSnapshotAsRoot: Readonly<RootSkillScriptExecutorProviderSnapshot> =
  deepProviderSnapshot;
const rootNameAsDeep: typeof DeepSkillScriptExecutorProviderName =
  RootSkillScriptExecutorProviderName;
const deepNameAsRoot: typeof RootSkillScriptExecutorProviderName =
  DeepSkillScriptExecutorProviderName;

function rootHandleAsDeep(
  handle: Readonly<RootSkillScriptExecutionHandle>,
): Readonly<DeepSkillScriptExecutionHandle> {
  return handle;
}

function deepHandleAsRoot(
  handle: Readonly<DeepSkillScriptExecutionHandle>,
): Readonly<RootSkillScriptExecutionHandle> {
  return handle;
}

void structuralResult;
void detachedStructuralResult;
void rootProviderAsDeep;
void deepProviderAsRoot;
void rootPreparedAsDeep;
void deepPreparedAsRoot;
void rootSnapshotAsDeep;
void deepSnapshotAsRoot;
void rootNameAsDeep;
void deepNameAsRoot;
void rootHandleAsDeep;
void deepHandleAsRoot;
