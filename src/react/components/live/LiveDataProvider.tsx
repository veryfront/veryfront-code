import type React from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { VeryfrontConfig } from "@veryfront/config";
import type { ComponentFunction, Entity } from "@veryfront/types";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

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
  updateConfig: (_config: Partial<VeryfrontConfig>) => void;
  subscribe: (callback: () => void) => () => void;
}

const LiveDataContext = createContext<LiveDataContextValue | null>(null);

export function LiveDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<LiveData>({
    entities: new Map(),
    components: new Map(),
    styles: new Map(),
    config: {
      /* empty */
    },
  });

  const [subscribers, setSubscribers] = useState<Set<() => void>>(new Set());

  const notifySubscribers = useCallback(() => {
    subscribers.forEach((callback) => callback());
  }, [subscribers]);

  const updateEntity = useCallback(
    (id: string, entityData: Entity) => {
      setData((prev) => {
        const newData = { ...prev };
        newData.entities = new Map(prev.entities);
        newData.entities.set(id, entityData);
        return newData;
      });
      notifySubscribers();
    },
    [notifySubscribers],
  );

  const updateComponent = useCallback(
    (name: string, component: ComponentFunction) => {
      setData((prev) => {
        const newData = { ...prev };
        newData.components = new Map(prev.components);
        newData.components.set(name, component);
        return newData;
      });
      notifySubscribers();
    },
    [notifySubscribers],
  );

  const updateStyle = useCallback(
    (id: string, css: string) => {
      setData((prev) => {
        const newData = { ...prev };
        newData.styles = new Map(prev.styles);
        newData.styles.set(id, css);
        return newData;
      });
      notifySubscribers();
    },
    [notifySubscribers],
  );

  const updateConfig = useCallback(
    (config: Partial<VeryfrontConfig>) => {
      setData((prev) => ({ ...prev, config }));
      notifySubscribers();
    },
    [notifySubscribers],
  );

  const subscribe = useCallback((callback: () => void) => {
    setSubscribers((prev) => new Set(prev).add(callback));
    return () => {
      setSubscribers((prev) => {
        const newSet = new Set(prev);
        newSet.delete(callback);
        return newSet;
      });
    };
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "studio:update") {
        const { target, id, data } = event.data;

        switch (target) {
          case "entity":
            updateEntity(id, data);
            break;
          case "component":
            updateComponent(id, data);
            break;
          case "style":
            updateStyle(id, data);
            break;
          case "config":
            updateConfig(data);
            break;
        }
      }
    };

    globalThis.addEventListener("message", handleMessage);
    return () => globalThis.removeEventListener("message", handleMessage);
  }, [updateEntity, updateComponent, updateStyle, updateConfig]);

  return (
    <LiveDataContext.Provider
      value={{
        data,
        updateEntity,
        updateComponent,
        updateStyle,
        updateConfig,
        subscribe,
      }}
    >
      {children}
    </LiveDataContext.Provider>
  );
}

export function useLiveData() {
  const context = useContext(LiveDataContext);
  if (!context) {
    throw toError(createError({
      type: "config",
      message: "useLiveData must be used within LiveDataProvider",
    }));
  }
  return context;
}

export function useEntity(id: string) {
  const { data, subscribe } = useLiveData();
  const [entity, setEntity] = useState(data.entities.get(id));

  useEffect(() => {
    const updateEntity = () => {
      setEntity(data.entities.get(id));
    };

    return subscribe(updateEntity);
  }, [id, data, subscribe]);

  return entity;
}
