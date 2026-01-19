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
  if (!Component || typeof Component === "string" || typeof Component === "number") {
    return { type: "html", html: Component ? String(Component) : "" };
  }

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

  if (typeof Component === "function") {
    try {
      const element = typeof Component === "function" && Component.prototype?.render
        ? React.createElement(Component as React.ComponentClass, props)
        : await (Component as React.FC)(props);

      if (!element) {
        return { type: "html", html: "" };
      }

      if (React.isValidElement(element)) {
        return processElement(element, clientManifest, clientRefs);
      }

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
  const { type, props } = element;

  if (typeof type === "string") {
    const processedChildren = await renderChildren(props.children, clientManifest, clientRefs);
    const hasClientComponents = processedChildren.some((child) => child.type === "client");

    if (!hasClientComponents && processedChildren.every((child) => child.type === "html")) {
      const html = await renderToStringAdapter(element as React.ReactElement);
      return { type: "html", html };
    }

    const tagName = type;
    const attrs = renderAttributes(props);
    const childrenHtml = await Promise.all(
      processedChildren.map((child) => treeToHTML(child)),
    );

    const html = `<${tagName}${attrs}>${childrenHtml.join("")}</${tagName}>`;
    return { type: "html", html };
  }

  if (typeof type === "function") {
    return renderTree(type, props as Record<string, unknown>, clientManifest, clientRefs);
  }

  if (type === React.Fragment) {
    const children = await renderChildren(props.children, clientManifest, clientRefs);
    return { type: "fragment", children };
  }

  const html = await renderToStringAdapter(element as React.ReactElement);
  return { type: "html", html };
}

export function renderChildren(
  children: React.ReactNode,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
): Promise<RSCNode[]> {
  if (!children) return Promise.resolve([]);

  const childArray = React.Children.toArray(children);

  return Promise.all(
    childArray.map((child) =>
      React.isValidElement(child)
        ? processElement(child, clientManifest, clientRefs)
        : Promise.resolve({ type: "html", html: String(child) } as RSCNode)
    ),
  );
}
