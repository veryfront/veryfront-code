import { rendererLogger as logger } from "@veryfront/utils";
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

export function useFormStatusCompat(): FormStatus {
  if (hasFeature("useFormStatus") && hasReactHook("useFormStatus")) {
    try {
      type ReactWithFormStatus = typeof React & {
        useFormStatus: () => FormStatus;
      };
      const { useFormStatus } = React as ReactWithFormStatus;
      return useFormStatus();
    } catch (_error) {
      logger.warn("useFormStatus not available in current React version");
    }
  }

  return {
    pending: false,
    data: null,
    method: null,
    action: null,
  };
}

export function useOptimisticCompat<State, OptimisticState = State>(
  state: State,
  updateFn?: (currentState: State, optimisticValue: OptimisticState) => State,
): [State, (action: OptimisticStateAction<OptimisticState>) => void] {
  if (hasFeature("useOptimistic") && hasReactHook("useOptimistic")) {
    try {
      type ReactWithOptimistic = typeof React & {
        useOptimistic: <S, O = S>(
          state: S,
          updateFn?: (currentState: S, optimisticValue: O) => S,
        ) => [S, (action: OptimisticStateAction<O>) => void];
      };
      const { useOptimistic } = React as ReactWithOptimistic;
      return useOptimistic(state, updateFn);
    } catch (_error) {
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
      } else {
        const nextState = updateFn
          ? updateFn(optimisticState, action)
          : (action as State & OptimisticState);
        setOptimisticState(nextState);
      }
    },
    [optimisticState, updateFn],
  );

  return [optimisticState, updateOptimisticState];
}

export function useTransitionCompat() {
  const _versionInfo = getReactVersionInfo();

  if (_versionInfo.isReact18 || _versionInfo.isReact19) {
    try {
      return React.useTransition();
    } catch (_error) {
      logger.warn("useTransition not available, falling back to mock");
    }
  }

  const [isPending, setIsPending] = React.useState(false);

  const startTransition = React.useCallback((callback: () => void) => {
    setIsPending(true);

    setTimeout(() => {
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
    } catch (_error) {
      logger.warn("useDeferredValue not available, returning value directly");
    }
  }

  return value;
}

let idCounter = 0;

export function useIdCompat() {
  const versionInfo = getReactVersionInfo();

  if (versionInfo.isReact18 || versionInfo.isReact19) {
    try {
      return React.useId();
    } catch (_error) {
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
}) {
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

export const CompatHooksContext = React.createContext<CompatHooks>({
  useFormStatus: useFormStatusCompat,
  useOptimistic: useOptimisticCompat,
  useTransition: useTransitionCompat,
  useDeferredValue: useDeferredValueCompat,
  useId: useIdCompat,
});

export function useCompatHooks() {
  return React.useContext(CompatHooksContext);
}

export function CompatHooksProvider({ children }: { children: React.ReactNode }) {
  const hooks: CompatHooks = {
    useFormStatus: useFormStatusCompat,
    useOptimistic: useOptimisticCompat,
    useTransition: useTransitionCompat,
    useDeferredValue: useDeferredValueCompat,
    useId: useIdCompat,
  };

  return React.createElement(CompatHooksContext.Provider, { value: hooks }, children);
}

export const compatHooks = {
  useFormStatus: useFormStatusCompat,
  useOptimistic: useOptimisticCompat,
  useTransition: useTransitionCompat,
  useDeferredValue: useDeferredValueCompat,
  useId: useIdCompat,
} as const;
