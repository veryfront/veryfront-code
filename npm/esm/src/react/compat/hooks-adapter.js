import * as dntShim from "../../../_dnt.shims.js";
import { rendererLogger as logger } from "../../utils/index.js";
import * as React from "react";
import { getReactVersionInfo, hasFeature } from "./version-detector/index.js";
function hasReactHook(hookName) {
    return typeof React[hookName] === "function";
}
export function useFormStatusCompat() {
    if (hasFeature("useFormStatus") && hasReactHook("useFormStatus")) {
        try {
            return React.useFormStatus();
        }
        catch {
            logger.warn("useFormStatus not available in current React version");
        }
    }
    return { pending: false, data: null, method: null, action: null };
}
export function useOptimisticCompat(state, updateFn) {
    if (hasFeature("useOptimistic") && hasReactHook("useOptimistic")) {
        try {
            return React.useOptimistic(state, updateFn);
        }
        catch {
            logger.warn("useOptimistic not available in current React version");
        }
    }
    const [optimisticState, setOptimisticState] = React.useState(state);
    React.useEffect(() => {
        setOptimisticState(state);
    }, [state]);
    const updateOptimisticState = React.useCallback((action) => {
        if (typeof action === "function") {
            const actionFn = action;
            setOptimisticState((current) => {
                const newState = actionFn(current);
                return updateFn ? updateFn(current, newState) : newState;
            });
            return;
        }
        const nextState = updateFn
            ? updateFn(optimisticState, action)
            : action;
        setOptimisticState(nextState);
    }, [optimisticState, updateFn]);
    return [optimisticState, updateOptimisticState];
}
export function useTransitionCompat() {
    const versionInfo = getReactVersionInfo();
    if (versionInfo.isReact18 || versionInfo.isReact19) {
        try {
            return React.useTransition();
        }
        catch {
            logger.warn("useTransition not available, falling back to mock");
        }
    }
    const [isPending, setIsPending] = React.useState(false);
    const startTransition = React.useCallback((callback) => {
        setIsPending(true);
        dntShim.setTimeout(() => {
            callback();
            setIsPending(false);
        }, 0);
    }, []);
    return [isPending, startTransition];
}
export function useDeferredValueCompat(value) {
    const versionInfo = getReactVersionInfo();
    if (versionInfo.isReact18 || versionInfo.isReact19) {
        try {
            return React.useDeferredValue(value);
        }
        catch {
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
        }
        catch {
            logger.warn("useId not available, using fallback");
        }
    }
    const [id] = React.useState(() => `:r${idCounter++}:`);
    return id;
}
export function SuspenseCompat({ children, fallback, }) {
    if (!hasFeature("suspense")) {
        logger.warn("Limited Suspense support in React 17");
        return React.createElement(React.Fragment, null, children);
    }
    return React.createElement(React.Suspense, { fallback }, children);
}
// Lazy-initialized context to avoid module-level React.createContext() calls
// that can fail during parallel test execution with inconsistent React instances
let compatHooksContext = null;
function getCompatHooksContext() {
    compatHooksContext ??= React.createContext({
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
export function resetCompatHooksContext() {
    compatHooksContext = null;
}
export const CompatHooksContext = {
    get Provider() {
        return getCompatHooksContext().Provider;
    },
    get Consumer() {
        return getCompatHooksContext().Consumer;
    },
    get displayName() {
        return getCompatHooksContext().displayName;
    },
};
export function useCompatHooks() {
    return React.useContext(getCompatHooksContext());
}
export function CompatHooksProvider({ children, }) {
    const hooks = {
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
};
