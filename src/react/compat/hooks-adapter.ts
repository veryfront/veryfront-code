import { rendererLogger as logger } from "#veryfront/utils";
import * as React from "react";
import { getReactVersionInfo, hasFeature } from "./version-detector/index.ts";

export interface FormStatus {
  pending: boolean;
  data: FormData | null;
  method: string | null;
  action: string | null;
}

export type OptimisticStateAction<State> = State | ((currentState: State) => State);

function hasReactHook(hookName: string): boolean {
  return typeof (React as Record<string, unknown>)[hookName] === "function";
}

function createDefaultFormStatus(): FormStatus {
  return { pending: false, data: null, method: null, action: null };
}

function supportsConcurrentHooks(): boolean {
  const { isReact18, isReact19 } = getReactVersionInfo();
  return isReact18 || isReact19;
}

function warnHookFallback(hookName: string, fallbackDescription: string): void {
  logger.warn(`${hookName} not available, ${fallbackDescription}`);
}

export function createTransitionFallbackScheduler(
  onPendingChange: (pending: boolean) => void,
): {
  destroy(): void;
  startTransition(callback: () => void): void;
} {
  const timers = new Set<ReturnType<typeof setTimeout>>();

  return {
    destroy() {
      for (const timerId of timers) clearTimeout(timerId);
      timers.clear();
    },
    startTransition(callback: () => void) {
      onPendingChange(true);

      const timerId = setTimeout(() => {
        timers.delete(timerId);
        callback();
        onPendingChange(false);
      }, 0);

      timers.add(timerId);
    },
  };
}

export function useFormStatusCompat(): FormStatus {
  if (!hasFeature("useFormStatus") || !hasReactHook("useFormStatus")) {
    return createDefaultFormStatus();
  }

  try {
    return (React as typeof React & { useFormStatus: () => FormStatus }).useFormStatus();
  } catch {
    warnHookFallback("useFormStatus", "falling back to the default idle state");
    return createDefaultFormStatus();
  }
}

export function useOptimisticCompat<State, OptimisticState = State>(
  state: State,
  updateFn?: (currentState: State, optimisticValue: OptimisticState) => State,
): [State, (action: OptimisticStateAction<OptimisticState>) => void] {
  if (hasFeature("useOptimistic") && hasReactHook("useOptimistic")) {
    try {
      return (
        React as typeof React & {
          useOptimistic: <S, O = S>(
            state: S,
            updateFn?: (currentState: S, optimisticValue: O) => S,
          ) => [S, (action: OptimisticStateAction<O>) => void];
        }
      ).useOptimistic(state, updateFn);
    } catch {
      warnHookFallback("useOptimistic", "falling back to React.useState");
    }
  }

  const [optimisticState, setOptimisticState] = React.useState(state);

  React.useEffect(() => {
    setOptimisticState(state);
  }, [state]);

  const updateOptimisticState = React.useCallback(
    (action: OptimisticStateAction<OptimisticState>) => {
      if (typeof action === "function") {
        const actionFn = action as (currentState: State) => State;

        setOptimisticState((current) => {
          const newState = actionFn(current);
          return updateFn ? updateFn(current, newState as State & OptimisticState) : newState;
        });

        return;
      }

      const nextState = updateFn
        ? updateFn(optimisticState, action)
        : (action as State & OptimisticState);

      setOptimisticState(nextState);
    },
    [optimisticState, updateFn],
  );

  return [optimisticState, updateOptimisticState];
}

export function useTransitionCompat(): ReturnType<typeof React.useTransition> {
  if (supportsConcurrentHooks()) {
    try {
      return React.useTransition();
    } catch {
      warnHookFallback("useTransition", "falling back to the timeout scheduler");
    }
  }

  const [isPending, setIsPending] = React.useState(false);

  const schedulerRef = React.useRef<ReturnType<typeof createTransitionFallbackScheduler>>(
    undefined,
  );
  if (!schedulerRef.current) {
    schedulerRef.current = createTransitionFallbackScheduler(setIsPending);
  }
  React.useEffect(
    () => () => schedulerRef.current?.destroy(),
    [],
  );

  const startTransition = React.useCallback((callback: () => void) => {
    schedulerRef.current?.startTransition(callback);
  }, []);

  return [isPending, startTransition];
}

export function useDeferredValueCompat<T>(value: T): T {
  if (supportsConcurrentHooks()) {
    try {
      return React.useDeferredValue(value);
    } catch {
      warnHookFallback("useDeferredValue", "returning the value directly");
    }
  }

  return value;
}

let idCounter = 0;

export function useIdCompat(): string {
  if (supportsConcurrentHooks()) {
    try {
      return React.useId();
    } catch {
      warnHookFallback("useId", "using the incremental fallback id");
    }
  }

  const [id] = React.useState(() => `:r${idCounter++}:`);
  return id;
}

export function SuspenseCompat({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}): React.ReactElement {
  if (!hasFeature("suspense")) {
    logger.warn("Limited Suspense support in React 17");
    return React.createElement(React.Fragment, null, children);
  }

  return React.createElement(React.Suspense, { fallback }, children);
}

export interface CompatHooks {
  useFormStatus: typeof useFormStatusCompat;
  useOptimistic: typeof useOptimisticCompat;
  useTransition: typeof useTransitionCompat;
  useDeferredValue: typeof useDeferredValueCompat;
  useId: typeof useIdCompat;
}

const defaultCompatHooks: CompatHooks = {
  useFormStatus: useFormStatusCompat,
  useOptimistic: useOptimisticCompat,
  useTransition: useTransitionCompat,
  useDeferredValue: useDeferredValueCompat,
  useId: useIdCompat,
};

let compatHooksContext: React.Context<CompatHooks> | null = null;

function getCompatHooksContext(): React.Context<CompatHooks> {
  compatHooksContext ??= React.createContext<CompatHooks>(defaultCompatHooks);

  return compatHooksContext;
}

/**
 * Reset the compat hooks context for test isolation.
 * Call this between tests to prevent React instance conflicts.
 */
export function resetCompatHooksContext(): void {
  compatHooksContext = null;
}

export function useCompatHooks(): CompatHooks {
  return React.useContext(getCompatHooksContext());
}

export function CompatHooksProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return React.createElement(
    getCompatHooksContext().Provider,
    { value: defaultCompatHooks },
    children,
  );
}

export const compatHooks = defaultCompatHooks;
