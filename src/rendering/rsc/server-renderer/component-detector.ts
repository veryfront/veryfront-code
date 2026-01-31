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

  if (
    Component.__rsc_client === true ||
    Component.$$typeof === Symbol.for("react.client.reference")
  ) {
    return true;
  }

  return clientManifest.has(getComponentId(Component));
}

export function getComponentId(Component: RSCComponent): string {
  return Component.__rsc_id ?? Component.displayName ?? Component.name ?? "Unknown";
}

export function registerClientRef(
  id: string,
  Component: RSCComponent,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
): void {
  if (clientRefs.has(id)) return;

  const path = clientManifest.get(id)?.path ??
    Component.__rsc_path ??
    `/_veryfront/client/${id}.js`;

  clientRefs.set(id, path);
}
