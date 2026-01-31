import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type React from "react";
import type { VeryfrontConfig } from "#veryfront/config";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type { ComponentFunction, Entity } from "#veryfront/types";

interface LiveData {
  entities: Map<string, Entity>;
  components: Map<string, ComponentFunction>;
  styles: Map<string, string>;
  config: Partial<VeryfrontConfig>;
}

interface LiveDataContextValue {
  data: LiveData;
  updateEntity: (id: string, data: Entity) => void;
  updateComponent: (name: string, component: ComponentFunction) => void;
  updateStyle: (id: string, css: string) => void;
  updateConfig: (config: Partial<VeryfrontConfig>) => void;
  subscribe: (callback: () => void) => () => void;
}

const LiveDataContext = createContext<LiveDataContextValue | null>(null);

export function LiveDataProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const [data, setData] = useState<LiveData>({
    entities: new Map(),
    components: new Map(),
    styles: new Map(),
    config: {},
  });

  const [subscribers, setSubscribers] = useState<Set<() => void>>(new Set());

  const notifySubscribers = useCallback((): void => {
    subscribers.forEach((callback) => callback());
  }, [subscribers]);

  const updateMap = useCallback(
    <K, V>(key: K, value: V, mapKey: "entities" | "components" | "styles"): void => {
      setData((prev) => ({
        ...prev,
        [mapKey]: new Map(prev[mapKey] as Map<K, V>).set(key, value),
      }));
      notifySubscribers();
    },
    [notifySubscribers],
  );

  const updateEntity = useCallback(
    (id: string, entityData: Entity): void => updateMap(id, entityData, "entities"),
    [updateMap],
  );

  const updateComponent = useCallback(
    (name: string, component: ComponentFunction): void => updateMap(name, component, "components"),
    [updateMap],
  );

  const updateStyle = useCallback((id: string, css: string): void => updateMap(id, css, "styles"), [
    updateMap,
  ]);

  const updateConfig = useCallback(
    (config: Partial<VeryfrontConfig>): void => {
      setData((prev) => ({ ...prev, config }));
      notifySubscribers();
    },
    [notifySubscribers],
  );

  const subscribe = useCallback((callback: () => void): () => void => {
    setSubscribers((prev) => new Set(prev).add(callback));

    return () => {
      setSubscribers((prev) => {
        const next = new Set(prev);
        next.delete(callback);
        return next;
      });
    };
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent): void {
      if (event.data?.type !== "studio:update") return;

      const { target, id, data } = event.data;

      switch (target) {
        case "entity":
          updateEntity(id, data);
          return;
        case "component":
          updateComponent(id, data);
          return;
        case "style":
          updateStyle(id, data);
          return;
        case "config":
          updateConfig(data);
          return;
      }
    }

    globalThis.addEventListener("message", handleMessage);
    return () => globalThis.removeEventListener("message", handleMessage);
  }, [updateEntity, updateComponent, updateStyle, updateConfig]);

  return (
    <LiveDataContext.Provider
      value={{ data, updateEntity, updateComponent, updateStyle, updateConfig, subscribe }}
    >
      {children}
    </LiveDataContext.Provider>
  );
}

export function useLiveData(): LiveDataContextValue {
  const context = useContext(LiveDataContext);
  if (context) return context;

  throw toError(
    createError({
      type: "config",
      message: "useLiveData must be used within LiveDataProvider",
    }),
  );
}

export function useEntity(id: string): Entity | undefined {
  const { data, subscribe } = useLiveData();
  const [entity, setEntity] = useState(() => data.entities.get(id));

  useEffect(() => {
    function handleUpdate(): void {
      setEntity(data.entities.get(id));
    }

    return subscribe(handleUpdate);
  }, [id, data, subscribe]);

  return entity;
}
