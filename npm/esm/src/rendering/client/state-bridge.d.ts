import type { DependencyList, Dispatch, EffectCallback, SetStateAction } from "react";
export interface StateStore {
    get<T = unknown>(key: string): T | undefined;
    set<T>(key: string, value: T): void;
    subscribe<T>(key: string, callback: (value: T) => void): () => void;
    clear(): void;
}
interface ReactHooksSubset {
    useState: <S>(initialState: S | (() => S)) => [S, Dispatch<SetStateAction<S>>];
    useEffect: (effect: EffectCallback, deps?: DependencyList) => void;
    useCallback: <T extends Function>(callback: T, deps: DependencyList) => T;
}
declare class StateBridge implements StateStore {
    private state;
    private listeners;
    private persistKeys;
    private boundSaveState;
    constructor();
    destroy(): void;
    get<T = unknown>(key: string): T | undefined;
    set<T>(key: string, value: T): void;
    private notifyListeners;
    subscribe<T>(key: string, callback: (value: T) => void): () => void;
    persist(key: string): void;
    clear(): void;
    private saveState;
    private saveKey;
    private restoreState;
    private readPersistedState;
}
export declare function getStateBridge(): StateBridge;
export declare function __resetBridgeForTesting(): void;
export declare function useBridgedState<T>(key: string, initialValue: T, options?: {
    persist?: boolean;
}, testReact?: ReactHooksSubset): [T, (value: T) => void];
export declare const SharedState: {
    use: typeof useBridgedState;
    get: (key: string) => unknown;
    set: <T>(key: string, value: T) => void;
};
export {};
//# sourceMappingURL=state-bridge.d.ts.map