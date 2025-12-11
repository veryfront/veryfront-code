
import type * as React from "react";
import type { ClientComponentMeta } from "../types.ts";

export type RSCComponent = React.ComponentType<any> & {
  __rsc_client?: boolean;
  __rsc_id?: string;
  __rsc_path?: string;
  displayName?: string;
  name?: string;
  $$typeof?: symbol;
};

export function isClientComponent(
  Component: RSCComponent,
  clientManifest: Map<string, ClientComponentMeta>,
): boolean {
  if (!Component) return false;

  if (Component.__rsc_client === true) return true;
  if (Component.$$typeof === Symbol.for("react.client.reference")) {
    return true;
  }

  const componentId = getComponentId(Component);
  return clientManifest.has(componentId);
}

export function getComponentId(Component: RSCComponent): string {
  if (Component.__rsc_id) return Component.__rsc_id;

  return Component.displayName || Component.name || "Unknown";
}

export function registerClientRef(
  id: string,
  Component: RSCComponent,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
): void {
  if (clientRefs.has(id)) return;

  const meta = clientManifest.get(id);
  if (meta) {
    clientRefs.set(id, meta.path);
  } else if (Component.__rsc_path) {
    clientRefs.set(id, Component.__rsc_path);
  } else {
    clientRefs.set(id, `/_veryfront/client/${id}.js`);
  }
}
