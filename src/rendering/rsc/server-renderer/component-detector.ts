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
 *
 * @param Component - Component to check
 * @param clientManifest - Map of registered client components
 * @returns True if component is a client component
 */
export function isClientComponent(
  Component: RSCComponent,
  clientManifest: Map<string, ClientComponentMeta>,
): boolean {
  if (!Component) return false;

  // Check for explicit client component marker
  if (Component.__rsc_client === true) return true;
  if (Component.$$typeof === Symbol.for("react.client.reference")) {
    return true;
  }

  // Check if component is in client manifest
  const componentId = getComponentId(Component);
  return clientManifest.has(componentId);
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
 *
 * @param id - Component ID
 * @param Component - Component to register
 * @param clientManifest - Map of registered client components
 * @param clientRefs - Map to store client references
 */
export function registerClientRef(
  id: string,
  Component: RSCComponent,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
): void {
  if (clientRefs.has(id)) return;

  const meta = clientManifest.get(id);
  if (meta) {
    // Use path from manifest
    clientRefs.set(id, meta.path);
  } else if (Component.__rsc_path) {
    // Use explicit path
    clientRefs.set(id, Component.__rsc_path);
  } else {
    // Generate path based on component name
    clientRefs.set(id, `/_veryfront/client/${id}.js`);
  }
}
