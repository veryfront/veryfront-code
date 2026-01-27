import * as React from "react";
import { serverLogger as logger } from "#veryfront/utils";
import { renderToStringAdapter } from "#veryfront/react";
import type { ClientComponentMeta, RSCNode } from "../types.ts";
import {
  getComponentId,
  isClientComponent,
  registerClientRef,
  type RSCComponent,
} from "./component-detector.ts";
import { renderAttributes, treeToHTML } from "./html-generator.ts";
import { serializeProps } from "./prop-serializer.ts";

/** Recursively renders a component tree to RSC nodes */
export async function renderTree(
  Component: React.ComponentType<any> | React.ReactElement | string | number | null | undefined,
  props: Record<string, unknown>,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
): Promise<RSCNode> {
  if (Component == null || typeof Component === "string" || typeof Component === "number") {
    return { type: "html", html: Component == null ? "" : String(Component) };
  }

  if (typeof Component === "function") {
    const rscComponent = Component as RSCComponent;

    if (isClientComponent(rscComponent, clientManifest)) {
      const componentId = getComponentId(rscComponent);
      registerClientRef(componentId, rscComponent, clientManifest, clientRefs);

      return {
        type: "client",
        component: componentId,
        props: serializeProps(props),
      };
    }

    try {
      const element = Component.prototype?.render
        ? React.createElement(Component as React.ComponentClass, props)
        : await (Component as React.FC)(props);

      if (!element) return { type: "html", html: "" };
      if (React.isValidElement(element)) return processElement(element, clientManifest, clientRefs);

      return { type: "html", html: String(element) };
    } catch (error) {
      logger.error("[RSC] Error rendering component:", error);
      throw error;
    }
  }

  if (React.isValidElement(Component)) {
    return processElement(Component, clientManifest, clientRefs);
  }

  return { type: "html", html: String(Component) };
}

/** Processes a React element into RSC node representation */
export async function processElement(
  element: React.ReactElement,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
): Promise<RSCNode> {
  const { type } = element;
  // Cast props for React 19 compatibility (props is unknown in R19 types)
  const props = element.props as Record<string, unknown>;

  if (type === React.Fragment) {
    const children = await renderChildren(
      props.children as React.ReactNode,
      clientManifest,
      clientRefs,
    );
    return { type: "fragment", children };
  }

  if (typeof type === "string") {
    const processedChildren = await renderChildren(
      props.children as React.ReactNode,
      clientManifest,
      clientRefs,
    );

    if (processedChildren.every((child) => child.type === "html")) {
      const html = await renderToStringAdapter(element);
      return { type: "html", html };
    }

    const attrs = renderAttributes(props);
    const childrenHtml = await Promise.all(processedChildren.map(treeToHTML));
    const html = `<${type}${attrs}>${childrenHtml.join("")}</${type}>`;

    return { type: "html", html };
  }

  if (typeof type === "function") {
    return renderTree(type, props as Record<string, unknown>, clientManifest, clientRefs);
  }

  const html = await renderToStringAdapter(element);
  return { type: "html", html };
}

export function renderChildren(
  children: React.ReactNode,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
): Promise<RSCNode[]> {
  if (!children) return Promise.resolve([]);

  return Promise.all(
    React.Children.toArray(children).map((child) => {
      if (React.isValidElement(child)) {
        return processElement(child, clientManifest, clientRefs);
      }

      return Promise.resolve({ type: "html", html: String(child) } as RSCNode);
    }),
  );
}
