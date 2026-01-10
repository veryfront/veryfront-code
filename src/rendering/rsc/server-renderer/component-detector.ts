/**
 * Component detection utilities for RSC renderer
 *
 * This module handles client component detection, identification,
 * and reference registration.
 *
 * @module component-detector
 */

import type * as React from "react";
import type { ClientComponentMeta } from "../types.ts";

/**
 * Extended component type with RSC metadata
 */
export type RSCComponent = React.ComponentType<any> & {
  __rsc_client?: boolean;
  __rsc_id?: string;
  __rsc_path?: string;
  displayName?: string;
  name?: string;
  $$typeof?: symbol;
};

/**
 * Check if a component is a client component
 */
export function isClientComponent(
  Component: RSCComponent,
  clientManifest: Map<string, ClientComponentMeta>,
): boolean {
  if (!Component) return false;

  // Check for explicit client component markers
  if (
    Component.__rsc_client === true ||
    Component.$$typeof === Symbol.for("react.client.reference")
  ) {
    return true;
  }

  // Check if component is in client manifest
  return clientManifest.has(getComponentId(Component));
}

/**
 * Get a stable ID for a component
 *
 * @param Component - Component to get ID for
 * @returns Component ID
 */
export function getComponentId(Component: RSCComponent): string {
  // Use explicit ID if available
  if (Component.__rsc_id) return Component.__rsc_id;

  // Use display name or function name
  return Component.displayName || Component.name || "Unknown";
}

/**
 * Register a client component reference
 */
export function registerClientRef(
  id: string,
  Component: RSCComponent,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
): void {
  if (clientRefs.has(id)) return;

  const meta = clientManifest.get(id);
  const path = meta?.path ?? Component.__rsc_path ?? `/_veryfront/client/${id}.js`;
  clientRefs.set(id, path);
}
