import * as dntShim from "../../../_dnt.shims.js";
import * as React from "react";
export interface FormStatus {
    pending: boolean;
    data: dntShim.FormData | null;
    method: string | null;
    action: string | null;
}
export type OptimisticStateAction<State> = State | ((currentState: State) => State);
export declare function useFormStatusCompat(): FormStatus;
export declare function useOptimisticCompat<State, OptimisticState = State>(state: State, updateFn?: (currentState: State, optimisticValue: OptimisticState) => State): [State, (action: OptimisticStateAction<OptimisticState>) => void];
export declare function useTransitionCompat(): ReturnType<typeof React.useTransition>;
export declare function useDeferredValueCompat<T>(value: T): T;
export declare function useIdCompat(): string;
export declare function SuspenseCompat({ children, fallback, }: {
    children: React.ReactNode;
    fallback: React.ReactNode;
}): React.ReactElement;
export interface CompatHooks {
    useFormStatus: typeof useFormStatusCompat;
    useOptimistic: typeof useOptimisticCompat;
    useTransition: typeof useTransitionCompat;
    useDeferredValue: typeof useDeferredValueCompat;
    useId: typeof useIdCompat;
}
/**
 * Reset the compat hooks context for test isolation.
 * Call this between tests to prevent React instance conflicts.
 */
export declare function resetCompatHooksContext(): void;
export declare const CompatHooksContext: {
    readonly Provider: React.Provider<CompatHooks>;
    readonly Consumer: React.Consumer<CompatHooks>;
    readonly displayName: string | undefined;
};
export declare function useCompatHooks(): CompatHooks;
export declare function CompatHooksProvider({ children, }: {
    children: React.ReactNode;
}): React.ReactElement;
export declare const compatHooks: {
    readonly useFormStatus: typeof useFormStatusCompat;
    readonly useOptimistic: typeof useOptimisticCompat;
    readonly useTransition: typeof useTransitionCompat;
    readonly useDeferredValue: typeof useDeferredValueCompat;
    readonly useId: typeof useIdCompat;
};
//# sourceMappingURL=hooks-adapter.d.ts.map