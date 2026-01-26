import * as dntShim from "../../../_dnt.shims.js";
import * as React from "react";
import { rendererLogger } from "../../utils/index.js";
class StateBridge {
    state = new Map();
    listeners = new Map();
    persistKeys = new Set();
    boundSaveState = null;
    constructor() {
        this.restoreState();
        if (typeof dntShim.dntGlobalThis === "undefined")
            return;
        this.boundSaveState = () => this.saveState();
        dntShim.dntGlobalThis.addEventListener("beforeunload", this.boundSaveState);
    }
    destroy() {
        if (this.boundSaveState && typeof dntShim.dntGlobalThis !== "undefined") {
            dntShim.dntGlobalThis.removeEventListener("beforeunload", this.boundSaveState);
            this.boundSaveState = null;
        }
        this.clear();
    }
    get(key) {
        return this.state.get(key);
    }
    set(key, value) {
        this.state.set(key, value);
        this.notifyListeners(key, value);
        if (this.persistKeys.has(key))
            this.saveKey(key, value);
    }
    notifyListeners(key, value) {
        const callbacks = this.listeners.get(key);
        if (!callbacks)
            return;
        for (const callback of callbacks)
            callback(value);
    }
    subscribe(key, callback) {
        let callbacks = this.listeners.get(key);
        if (!callbacks) {
            callbacks = new Set();
            this.listeners.set(key, callbacks);
        }
        const typedCallback = callback;
        callbacks.add(typedCallback);
        return () => {
            this.listeners.get(key)?.delete(typedCallback);
        };
    }
    persist(key) {
        this.persistKeys.add(key);
        const value = this.state.get(key);
        if (value !== undefined)
            this.saveKey(key, value);
    }
    clear() {
        this.state.clear();
        this.listeners.clear();
        sessionStorage?.removeItem("veryfront-state");
    }
    saveState() {
        if (typeof sessionStorage === "undefined")
            return;
        const persistedState = {};
        for (const key of this.persistKeys) {
            const value = this.state.get(key);
            if (value !== undefined)
                persistedState[key] = value;
        }
        sessionStorage.setItem("veryfront-state", JSON.stringify(persistedState));
    }
    saveKey(key, value) {
        if (typeof sessionStorage === "undefined")
            return;
        const state = this.readPersistedState() ?? {};
        state[key] = value;
        sessionStorage.setItem("veryfront-state", JSON.stringify(state));
    }
    restoreState() {
        if (typeof sessionStorage === "undefined")
            return;
        const state = this.readPersistedState();
        if (!state)
            return;
        for (const [key, value] of Object.entries(state)) {
            this.state.set(key, value);
            this.persistKeys.add(key);
        }
    }
    readPersistedState() {
        if (typeof sessionStorage === "undefined")
            return null;
        const stored = sessionStorage.getItem("veryfront-state");
        if (!stored)
            return null;
        try {
            const state = JSON.parse(stored);
            if (state && typeof state === "object" && !Array.isArray(state)) {
                return state;
            }
            throw new Error("Persisted state is not an object");
        }
        catch (error) {
            rendererLogger.error("[Veryfront] Failed to parse state from sessionStorage:", error);
            try {
                sessionStorage.removeItem("veryfront-state");
            }
            catch (clearError) {
                rendererLogger.error("[Veryfront] Failed to clear corrupted state:", clearError);
            }
            return null;
        }
    }
}
let bridgeInstance = null;
export function getStateBridge() {
    bridgeInstance ??= new StateBridge();
    return bridgeInstance;
}
export function __resetBridgeForTesting() {
    bridgeInstance?.destroy();
    bridgeInstance = null;
}
export function useBridgedState(key, initialValue, options, testReact) {
    const reactHooks = testReact ?? React;
    const { useState, useEffect, useCallback } = reactHooks;
    const bridge = getStateBridge();
    const [value, setValue] = useState((bridge.get(key) ?? initialValue));
    useEffect(() => {
        const unsubscribe = bridge.subscribe(key, setValue);
        if (options?.persist)
            bridge.persist(key);
        return unsubscribe;
    }, [bridge, key, options?.persist]);
    const setBridgedValue = useCallback((newValue) => {
        bridge.set(key, newValue);
        setValue(newValue);
    }, [bridge, key]);
    return [value, setBridgedValue];
}
export const SharedState = {
    use: useBridgedState,
    get: (key) => getStateBridge().get(key),
    set: (key, value) => getStateBridge().set(key, value),
};
