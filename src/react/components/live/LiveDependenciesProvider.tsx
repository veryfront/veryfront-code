import type React from "react";
import { useEffect, useState } from "react";

interface DependencyState {
  loading: boolean;
  loaded: Set<string>;
  errors: Map<string, Error>;
}

export function LiveDependenciesProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  const [, setDeps] = useState<DependencyState>({
    loading: false,
    loaded: new Set(),
    errors: new Map(),
  });

  useEffect((): () => void => {
    function handleMessage(event: MessageEvent): void {
      if (event.data?.type !== "studio:load-dependency") return;

      const url: string = event.data.url;

      setDeps((prev) => ({ ...prev, loading: true }));

      const script = document.createElement("script");
      script.src = url;
      script.type = "module";

      script.onload = (): void => {
        setDeps((prev) => ({
          ...prev,
          loading: false,
          loaded: new Set(prev.loaded).add(url),
        }));

        globalThis.parent.postMessage({ type: "app:dependency-loaded", url }, "*");
      };

      script.onerror = (): void => {
        const error = new Error(`Failed to load dependency: ${url}`);

        setDeps((prev) => ({
          ...prev,
          loading: false,
          errors: new Map(prev.errors).set(url, error),
        }));

        globalThis.parent.postMessage(
          { type: "app:dependency-error", url, error: error.message },
          "*",
        );
      };

      document.head.appendChild(script);
    }

    globalThis.addEventListener("message", handleMessage);
    return (): void => globalThis.removeEventListener("message", handleMessage);
  }, []);

  return <>{children}</>;
}
