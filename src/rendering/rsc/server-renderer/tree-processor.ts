/**
 * Tree processing utilities for RSC renderer
 *
 * This module handles recursive rendering of React component trees,
 * processing elements, and handling children.
 *
 * @module tree-processor
 */

import * as React from "react";
import { renderToString } from "react-dom/server";
import { serverLogger as logger } from "@veryfront/utils";
import type { ClientComponentMeta, RSCNode } from "../types.ts";
import {
  getComponentId,
  isClientComponent,
  registerClientRef,
  type RSCComponent,
} from "./component-detector.ts";
import { renderAttributes } from "./html-generator.ts";
import { serializeProps } from "./prop-serializer.ts";
import { treeToHTML } from "./html-generator.ts";

/**
 * Recursively render a component tree
 *
 * @param Component - Component or element to render
 * @param props - Props to pass to component
 * @param clientManifest - Map of registered client components
 * @param clientRefs - Map to store client references
 * @returns RSC node representation
 */
export async function renderTree(
  Component: React.ComponentType<any> | React.ReactElement | string | number | null | undefined,
  props: Record<string, unknown>,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
): Promise<RSCNode> {
  // Handle null/undefined
  if (!Component) {
    return { type: "html", html: "" };
  }

  // Handle strings and numbers
  if (typeof Component === "string" || typeof Component === "number") {
    return { type: "html", html: String(Component) };
  }

  // Check if this is a client component (only for function components)
  if (
    typeof Component === "function" && isClientComponent(Component as RSCComponent, clientManifest)
  ) {
    const componentId = getComponentId(Component as RSCComponent);
    registerClientRef(componentId, Component as RSCComponent, clientManifest, clientRefs);

    return {
      type: "client",
      component: componentId,
      props: serializeProps(props),
    };
  }

  // Handle function components (server components)
  if (typeof Component === "function") {
    try {
      // Call the component function - handle both FC and class components
      const element = typeof Component === "function" && Component.prototype?.render
        ? React.createElement(Component as React.ComponentClass, props)
        : await (Component as React.FC)(props);

      // If it returns null/undefined
      if (!element) {
        return { type: "html", html: "" };
      }

      // If it returns a React element, process it
      if (React.isValidElement(element)) {
        return processElement(element, clientManifest, clientRefs);
      }

      // Otherwise treat as HTML
      return { type: "html", html: String(element) };
    } catch (error) {
      logger.error("[RSC] Error rendering component:", error);
      throw error;
    }
  }

  // Handle React elements directly
  if (React.isValidElement(Component)) {
    return processElement(Component, clientManifest, clientRefs);
  }

  // Default: convert to string
  return { type: "html", html: String(Component) };
}

/**
 * Process a React element
 *
 * @param element - React element to process
 * @param clientManifest - Map of registered client components
 * @param clientRefs - Map to store client references
 * @returns RSC node representation
 */
export async function processElement(
  element: React.ReactElement,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
): Promise<RSCNode> {
  const { type, props } = element;

  // Handle HTML elements
  if (typeof type === "string") {
    // For HTML elements, we need to process children first to handle nested client components
    const processedChildren = await renderChildren(props.children, clientManifest, clientRefs);

    // If there are no client components in children, render as normal HTML
    const hasClientComponents = processedChildren.some((child) => child.type === "client");

    if (!hasClientComponents && processedChildren.every((child) => child.type === "html")) {
      // Simple case: no client components, render to string
      const html = renderToString(element as React.ReactElement);
      return { type: "html", html };
    }

    // Complex case: need to handle client components in children
    // Build HTML manually
    const tagName = type;
    const attrs = renderAttributes(props);
    const childrenHtml = await Promise.all(
      processedChildren.map((child) => treeToHTML(child)),
    );

    const html = `<${tagName}${attrs}>${childrenHtml.join("")}</${tagName}>`;
    return { type: "html", html };
  }

  // Handle components
  if (typeof type === "function") {
    return renderTree(type, props as Record<string, unknown>, clientManifest, clientRefs);
  }

  // Handle fragments
  if (type === React.Fragment) {
    const children = await renderChildren(props.children, clientManifest, clientRefs);
    return { type: "fragment", children };
  }

  // Default: render to string
  const html = renderToString(element as React.ReactElement);
  return { type: "html", html };
}

/**
 * Render children elements
 *
 * @param children - React children to render
 * @param clientManifest - Map of registered client components
 * @param clientRefs - Map to store client references
 * @returns Array of RSC nodes
 */
export async function renderChildren(
  children: React.ReactNode,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
): Promise<RSCNode[]> {
  if (!children) return [];

  const childArray = React.Children.toArray(children);

  // Parallelize child processing to avoid N+1 pattern
  const results = await Promise.all(
    childArray.map((child) => {
      if (React.isValidElement(child)) {
        return processElement(child, clientManifest, clientRefs);
      } else {
        return Promise.resolve({ type: "html", html: String(child) } as RSCNode);
      }
    }),
  );

  return results;
}
