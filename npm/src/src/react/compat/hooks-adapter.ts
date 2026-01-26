import * as dntShim from "../../../_dnt.shims.js";
import { rendererLogger as logger } from "../../utils/index.js";
import * as React from "react";
import { getReactVersionInfo, hasFeature } from "./version-detector/index.js";

export interface FormStatus {
  pending: boolean;
  data: dntShim.FormData | null;
  method: string | null;
  action: string | null;
}

export type OptimisticStateAction<State> = State | ((currentState: State) => State);

function hasReactHook(hookName: string): boolean {
  return typeof (React as Record<string, unknown>)[hookName] === "function";
}

export function useFormStatusCompat(): FormStatus {
  if (hasFeature("useFormStatus") && hasReactHook("useFormStatus")) {
    try {
      return (React as typeof React & { useFormStatus: () => FormStatus }).useFormStatus();
    } catch {
      logger.warn("useFormStatus not available in current React version");
    }
  }

  return { pending: false, data: null, method: null, action: null };
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
      logger.warn("useOptimistic not available in current React version");
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
  const versionInfo = getReactVersionInfo();

  if (versionInfo.isReact18 || versionInfo.isReact19) {
    try {
      return React.useTransition();
    } catch {
      logger.warn("useTransition not available, falling back to mock");
    }
  }

  const [isPending, setIsPending] = React.useState(false);

  const startTransition = React.useCallback((callback: () => void) => {
    setIsPending(true);

    dntShim.setTimeout(() => {
      callback();
      setIsPending(false);
    }, 0);
  }, []);

  return [isPending, startTransition];
}

export function useDeferredValueCompat<T>(value: T): T {
  const versionInfo = getReactVersionInfo();

  if (versionInfo.isReact18 || versionInfo.isReact19) {
    try {
      return React.useDeferredValue(value);
    } catch {
      logger.warn("useDeferredValue not available, returning value directly");
    }
  }

  return value;
}

let idCounter = 0;

export function useIdCompat(): string {
  const versionInfo = getReactVersionInfo();

  if (versionInfo.isReact18 || versionInfo.isReact19) {
    try {
      return React.useId();
    } catch {
      logger.warn("useId not available, using fallback");
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

// Lazy-initialized context to avoid module-level React.createContext() calls
// that can fail during parallel test execution with inconsistent React instances
let compatHooksContext: React.Context<CompatHooks> | null = null;

function getCompatHooksContext(): React.Context<CompatHooks> {
  compatHooksContext ??= React.createContext<CompatHooks>({
    useFormStatus: useFormStatusCompat,
    useOptimistic: useOptimisticCompat,
    useTransition: useTransitionCompat,
    useDeferredValue: useDeferredValueCompat,
    useId: useIdCompat,
  });

  return compatHooksContext;
}

/**
 * Reset the compat hooks context for test isolation.
 * Call this between tests to prevent React instance conflicts.
 */
export function resetCompatHooksContext(): void {
  compatHooksContext = null;
}

export const CompatHooksContext = {
  get Provider(): React.Provider<CompatHooks> {
    return getCompatHooksContext().Provider;
  },
  get Consumer(): React.Consumer<CompatHooks> {
    return getCompatHooksContext().Consumer;
  },
  get displayName(): string | undefined {
    return getCompatHooksContext().displayName;
  },
};

export function useCompatHooks(): CompatHooks {
  return React.useContext(getCompatHooksContext());
}

export function CompatHooksProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const hooks: CompatHooks = {
    useFormStatus: useFormStatusCompat,
    useOptimistic: useOptimisticCompat,
    useTransition: useTransitionCompat,
    useDeferredValue: useDeferredValueCompat,
    useId: useIdCompat,
  };

  return React.createElement(getCompatHooksContext().Provider, { value: hooks }, children);
}

export const compatHooks = {
  useFormStatus: useFormStatusCompat,
  useOptimistic: useOptimisticCompat,
  useTransition: useTransitionCompat,
  useDeferredValue: useDeferredValueCompat,
  useId: useIdCompat,
} as const;
