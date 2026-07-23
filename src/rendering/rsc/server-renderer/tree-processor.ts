import * as React from "react";
import { renderToStringAdapter } from "#veryfront/react";
import type { ClientComponentMeta, RSCNode } from "../types.ts";
import {
  getComponentId,
  isClientComponent,
  registerClientRef,
  type RSCComponent,
  type RSCComponentProps,
} from "./component-detector.ts";
import { escapeHtml, renderAttributes, treeToHTML } from "./html-generator.ts";
import { serializeProps } from "./prop-serializer.ts";

/** Recursively renders a component tree to RSC nodes */
export async function renderTree<Props extends RSCComponentProps = RSCComponentProps>(
  Component: React.ComponentType<Props> | React.ReactElement | string | number | null | undefined,
  props: Props,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
  reactVersion?: string,
): Promise<RSCNode> {
  if (Component == null || typeof Component === "string" || typeof Component === "number") {
    return { type: "html", html: Component == null ? "" : escapeHtml(String(Component)) };
  }

  if (React.isValidElement(Component)) {
    return processElement(Component, clientManifest, clientRefs, reactVersion);
  }

  if (typeof Component !== "function") {
    return { type: "html", html: escapeHtml(String(Component)) };
  }

  const rscComponent = Component as unknown as RSCComponent;

  if (isClientComponent(rscComponent, clientManifest)) {
    const componentId = getComponentId(rscComponent);
    registerClientRef(componentId, rscComponent, clientManifest, clientRefs);

    return {
      type: "client",
      component: componentId,
      props: serializeProps(props),
      children: await renderBoundaryChildren(
        props.children as React.ReactNode,
        clientManifest,
        clientRefs,
        reactVersion,
      ),
    };
  }

  const element = Component.prototype?.render
    ? await new (Component as React.ComponentClass<Props>)(props).render()
    : await (Component as React.FC<Props>)(props);

  if (element == null || typeof element === "boolean") return { type: "html", html: "" };
  if (React.isValidElement(element)) {
    return processElement(element, clientManifest, clientRefs, reactVersion);
  }

  return { type: "html", html: escapeHtml(String(element)) };
}

/** Processes a React element into RSC node representation */
export async function processElement(
  element: React.ReactElement,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
  reactVersion?: string,
): Promise<RSCNode> {
  const { type } = element;
  // Cast props for React 19 compatibility (props is unknown in R19 types)
  const props = element.props as Record<string, unknown>;

  if (type === React.Fragment) {
    const children = await renderChildren(
      props.children as React.ReactNode,
      clientManifest,
      clientRefs,
      reactVersion,
    );
    return { type: "fragment", children };
  }

  if (typeof type === "string") {
    const processedChildren = await renderChildren(
      props.children as React.ReactNode,
      clientManifest,
      clientRefs,
      reactVersion,
    );

    if (processedChildren.every((child) => child.type === "html")) {
      const html = await renderToStringAdapter(element, { reactVersion });
      return { type: "html", html };
    }

    const attrs = renderAttributes(props);
    const childrenHtml = await Promise.all(
      processedChildren.map((child) => treeToHTML(child, clientRefs, clientManifest)),
    );
    const html = `<${type}${attrs}>${childrenHtml.join("")}</${type}>`;

    return { type: "html", html };
  }

  if (typeof type === "function") {
    return renderTree(
      type as React.ComponentType<RSCComponentProps>,
      props,
      clientManifest,
      clientRefs,
      reactVersion,
    );
  }

  const html = await renderToStringAdapter(element, { reactVersion });
  return { type: "html", html };
}

export function renderChildren(
  children: React.ReactNode,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
  reactVersion?: string,
): Promise<RSCNode[]> {
  if (children == null || typeof children === "boolean") return Promise.resolve([]);

  return Promise.all(
    React.Children.toArray(children).map((child) => {
      if (React.isValidElement(child)) {
        return processElement(child, clientManifest, clientRefs, reactVersion);
      }

      return Promise.resolve({ type: "html" as const, html: escapeHtml(String(child)) });
    }),
  );
}

async function renderBoundaryChildren(
  children: React.ReactNode,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
  reactVersion?: string,
): Promise<RSCNode[]> {
  return await Promise.all(
    React.Children.toArray(children).map((child) =>
      renderBoundaryChild(child, clientManifest, clientRefs, reactVersion)
    ),
  );
}

async function renderBoundaryChild(
  child: React.ReactNode,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
  reactVersion?: string,
): Promise<RSCNode> {
  if (typeof child === "string" || typeof child === "number") {
    return { type: "html", text: String(child) };
  }

  if (!React.isValidElement(child)) {
    return { type: "fragment", children: [] };
  }

  const type = child.type;
  const props = child.props as Record<string, unknown>;
  if (type === React.Fragment) {
    return {
      type: "fragment",
      children: await renderBoundaryChildren(
        props.children as React.ReactNode,
        clientManifest,
        clientRefs,
        reactVersion,
      ),
    };
  }

  if (typeof type === "string") {
    return {
      type: "server",
      component: type,
      props: serializeProps(props),
      children: await renderBoundaryChildren(
        props.children as React.ReactNode,
        clientManifest,
        clientRefs,
        reactVersion,
      ),
    };
  }

  if (typeof type === "function") {
    const Component = type as RSCComponent;
    if (isClientComponent(Component, clientManifest)) {
      const componentId = getComponentId(Component);
      registerClientRef(componentId, Component, clientManifest, clientRefs);
      return {
        type: "client",
        component: componentId,
        props: serializeProps(props),
        children: await renderBoundaryChildren(
          props.children as React.ReactNode,
          clientManifest,
          clientRefs,
          reactVersion,
        ),
      };
    }

    const rendered = Component.prototype?.render
      ? new (Component as React.ComponentClass<RSCComponentProps>)(props).render()
      : await (Component as React.FC<RSCComponentProps>)(props);
    const renderedChildren = await renderBoundaryChildren(
      rendered,
      clientManifest,
      clientRefs,
      reactVersion,
    );
    return renderedChildren.length === 1
      ? renderedChildren[0]!
      : { type: "fragment", children: renderedChildren };
  }

  const html = await renderToStringAdapter(child, { reactVersion });
  return { type: "html", html };
}
