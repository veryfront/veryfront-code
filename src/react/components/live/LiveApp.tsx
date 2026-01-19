import type React from "react";
import { useEffect, useState } from "react";
import type { PageContext } from "#veryfront/types";
import type { MdxBundle } from "../LayoutComponent.tsx";
import { LiveDataProvider } from "./LiveDataProvider.tsx";
import { LiveDependenciesProvider } from "./LiveDependenciesProvider.tsx";
import { LiveLayoutComponent } from "./LiveLayoutComponent.tsx";
import { LivePageContextProvider } from "./LivePageContextProvider.tsx";
import { LiveProviderComponent } from "./LiveProviderComponent.tsx";
import { LiveStylesheetProvider } from "./LiveStylesheetProvider.tsx";

export interface LiveAppProps {
  children: React.ReactNode;
  providers?: MdxBundle[];
  layout?: MdxBundle;
  pageContext?: PageContext;
  mode?: "development" | "production";
  studioEnabled?: boolean;
}

export function LiveApp({
  children,
  providers = [],
  layout,
  pageContext,
  mode = "development",
  studioEnabled = false,
}: LiveAppProps) {
  const [isStudioConnected, setIsStudioConnected] = useState(false);

  useEffect(() => {
    if (studioEnabled && mode === "development") {
      const studioOrigin = globalThis.location.ancestorOrigins?.[0] || globalThis.location.origin;

      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== studioOrigin) {
          return;
        }

        if (event.data?.type === "studio:connected") {
          setIsStudioConnected(true);
        } else if (event.data?.type === "studio:disconnected") {
          setIsStudioConnected(false);
        }
      };

      globalThis.addEventListener("message", handleMessage);

      globalThis.parent.postMessage({
        action: "appUpdated",
        isInitialLoad: true,
        url: globalThis.location.href,
      }, studioOrigin);

      return () => {
        globalThis.removeEventListener("message", handleMessage);
      };
    }
  }, [studioEnabled, mode]);

  return (
    <LiveDataProvider>
      <LiveStylesheetProvider>
        <LiveDependenciesProvider>
          <LivePageContextProvider pageContext={pageContext}>
            <LiveProviderComponent providers={providers}>
              <LiveLayoutComponent layout={layout}>{children}</LiveLayoutComponent>
            </LiveProviderComponent>

            {isStudioConnected && (
              <div className="fixed bottom-4 left-4 bg-green-500 text-white px-3 py-1 rounded-full text-sm z-50">
                Studio Connected
              </div>
            )}
          </LivePageContextProvider>
        </LiveDependenciesProvider>
      </LiveStylesheetProvider>
    </LiveDataProvider>
  );
}
