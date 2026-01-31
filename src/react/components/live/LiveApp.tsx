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
}: LiveAppProps): React.ReactElement {
  const [isStudioConnected, setIsStudioConnected] = useState(false);

  useEffect((): void | (() => void) => {
    if (!studioEnabled || mode !== "development") {
      return;
    }

    const studioOrigin = globalThis.location.ancestorOrigins?.[0] ?? globalThis.location.origin;

    function handleMessage(event: MessageEvent): void {
      if (event.origin !== studioOrigin) {
        return;
      }

      const type = event.data?.type;

      if (type === "studio:connected") {
        setIsStudioConnected(true);
        return;
      }

      if (type === "studio:disconnected") {
        setIsStudioConnected(false);
      }
    }

    globalThis.addEventListener("message", handleMessage);

    globalThis.parent.postMessage(
      {
        action: "appUpdated",
        isInitialLoad: true,
        url: globalThis.location.href,
      },
      studioOrigin,
    );

    return (): void => {
      globalThis.removeEventListener("message", handleMessage);
    };
  }, [mode, studioEnabled]);

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
