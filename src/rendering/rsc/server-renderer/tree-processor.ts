import * as React from "react";
import { serverLogger } from "#veryfront/utils";
import { renderToStringAdapter } from "#veryfront/react";
import type { ClientComponentMeta, RSCNode } from "../types.ts";
import {
  getComponentId,
  isClientComponent,
  registerClientRef,
  type RSCComponent,
  type RSCComponentProps,
} from "./component-detector.ts";
import { escapeHtml, renderHostElement, treeToHTML } from "./html-generator.ts";
import { serializeProps } from "./prop-serializer.ts";
import {
  assertRscRenderCapacity,
  claimRscRenderNode,
  createRscRenderBudget,
  mapRscRenderChildren,
  MAX_RSC_RENDER_NODES,
  type RscRenderBudget,
} from "./tree-budget.ts";

const logger = serverLogger.component("rsc");

/** Recursively renders a component tree to RSC nodes */
export async function renderTree<Props extends RSCComponentProps = RSCComponentProps>(
  Component: React.ComponentType<Props> | React.ReactElement | string | number | null | undefined,
  props: Props,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
  reactVersion?: string,
): Promise<RSCNode> {
  return await renderTreeWithBudget(
    Component,
    props,
    clientManifest,
    clientRefs,
    reactVersion,
    createRscRenderBudget(),
    0,
  );
}

async function renderTreeWithBudget<Props extends RSCComponentProps = RSCComponentProps>(
  Component: React.ComponentType<Props> | React.ReactElement | string | number | null | undefined,
  props: Props,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
  reactVersion: string | undefined,
  budget: RscRenderBudget,
  depth: number,
): Promise<RSCNode> {
  assertRscRenderCapacity(budget, 0, depth);

  if (Component == null || typeof Component === "string" || typeof Component === "number") {
    return createHtmlNode(
      Component == null ? "" : escapeHtml(String(Component)),
      budget,
      depth,
    );
  }

  if (React.isValidElement(Component)) {
    return processElementWithBudget(
      Component,
      clientManifest,
      clientRefs,
      reactVersion,
      budget,
      depth,
    );
  }

  if (typeof Component !== "function") {
    throw new TypeError("RSC root must be a React component, element, string, number, or null");
  }

  const rscComponent = Component as unknown as RSCComponent;

  if (isClientComponent(rscComponent, clientManifest)) {
    claimRscRenderNode(budget, depth);
    const componentId = getComponentId(rscComponent);
    registerClientRef(componentId, rscComponent, clientManifest, clientRefs);

    return {
      type: "client",
      component: componentId,
      props: serializeProps(props),
      children: await renderBoundaryChildrenWithBudget(
        readChildrenProp(props),
        clientManifest,
        clientRefs,
        reactVersion,
        budget,
        depth + 1,
      ),
    };
  }

  try {
    const element = Component.prototype?.render
      ? React.createElement(Component as React.ComponentClass<Props>, props)
      : await (Component as React.FC<Props>)(props);

    if (element == null || typeof element === "boolean") {
      return createHtmlNode("", budget, depth);
    }
    if (React.isValidElement(element)) {
      return processElementWithBudget(
        element,
        clientManifest,
        clientRefs,
        reactVersion,
        budget,
        depth + 1,
      );
    }
    if (
      typeof element === "string" ||
      typeof element === "number" ||
      typeof element === "bigint"
    ) {
      return createHtmlNode(escapeHtml(String(element)), budget, depth);
    }
    throw new TypeError("RSC server components must return a valid React node");
  } catch (error) {
    logger.error("Error rendering component:", error);
    throw error;
  }
}

/** Processes a React element into RSC node representation */
export async function processElement(
  element: React.ReactElement,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
  reactVersion?: string,
): Promise<RSCNode> {
  return await processElementWithBudget(
    element,
    clientManifest,
    clientRefs,
    reactVersion,
    createRscRenderBudget(),
    0,
  );
}

async function processElementWithBudget(
  element: React.ReactElement,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
  reactVersion: string | undefined,
  budget: RscRenderBudget,
  depth: number,
): Promise<RSCNode> {
  assertRscRenderCapacity(budget, 0, depth);
  const { type } = element;
  // Cast props for React 19 compatibility (props is unknown in R19 types)
  const props = element.props as Record<string, unknown>;

  if (type === React.Fragment) {
    claimRscRenderNode(budget, depth);
    const children = await renderChildrenWithBudget(
      readChildrenProp(props),
      clientManifest,
      clientRefs,
      reactVersion,
      budget,
      depth + 1,
    );
    return { type: "fragment", children };
  }

  if (typeof type === "string") {
    const processedChildren = await renderChildrenWithBudget(
      readChildrenProp(props),
      clientManifest,
      clientRefs,
      reactVersion,
      budget,
      depth + 1,
    );

    if (processedChildren.every((child) => child.type === "html")) {
      const html = await renderToStringAdapter(element, { reactVersion });
      return createHtmlNode(html, budget, depth);
    }

    const childrenHtml = await treeToHTML(
      { type: "fragment", children: processedChildren },
      clientRefs,
      clientManifest,
      reactVersion,
    );
    const html = await renderHostElement(type, props, childrenHtml, reactVersion);

    return createHtmlNode(html, budget, depth);
  }

  if (typeof type === "function") {
    return renderTreeWithBudget(
      type as React.ComponentType<RSCComponentProps>,
      props,
      clientManifest,
      clientRefs,
      reactVersion,
      budget,
      depth + 1,
    );
  }

  const html = await renderToStringAdapter(element, { reactVersion });
  return createHtmlNode(html, budget, depth);
}

export async function renderChildren(
  children: React.ReactNode,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
  reactVersion?: string,
): Promise<RSCNode[]> {
  return await renderChildrenWithBudget(
    children,
    clientManifest,
    clientRefs,
    reactVersion,
    createRscRenderBudget(),
    0,
  );
}

async function renderChildrenWithBudget(
  children: React.ReactNode,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
  reactVersion: string | undefined,
  budget: RscRenderBudget,
  depth: number,
): Promise<RSCNode[]> {
  if (children == null || typeof children === "boolean") return [];
  const childValues = collectReactChildren(children, budget, depth);

  return await mapRscRenderChildren(
    childValues,
    async (child) => {
      if (React.isValidElement(child)) {
        return await processElementWithBudget(
          child,
          clientManifest,
          clientRefs,
          reactVersion,
          budget,
          depth,
        );
      }

      if (
        typeof child !== "string" &&
        typeof child !== "number" &&
        typeof child !== "bigint"
      ) {
        throw new TypeError("RSC children must be valid React nodes");
      }
      return createHtmlNode(escapeHtml(String(child)), budget, depth);
    },
  );
}

async function renderBoundaryChildrenWithBudget(
  children: React.ReactNode,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
  reactVersion: string | undefined,
  budget: RscRenderBudget,
  depth: number,
): Promise<RSCNode[]> {
  if (children == null || typeof children === "boolean") return [];
  const childValues = collectReactChildren(children, budget, depth);
  return await mapRscRenderChildren(
    childValues,
    (child) =>
      renderBoundaryChild(
        child,
        clientManifest,
        clientRefs,
        reactVersion,
        budget,
        depth,
      ),
  );
}

async function renderBoundaryChild(
  child: React.ReactNode,
  clientManifest: Map<string, ClientComponentMeta>,
  clientRefs: Map<string, string>,
  reactVersion: string | undefined,
  budget: RscRenderBudget,
  depth: number,
): Promise<RSCNode> {
  assertRscRenderCapacity(budget, 0, depth);
  if (
    typeof child === "string" ||
    typeof child === "number" ||
    typeof child === "bigint"
  ) {
    claimRscRenderNode(budget, depth);
    return { type: "html", text: String(child) };
  }

  if (!React.isValidElement(child)) {
    throw new TypeError("RSC boundary children must be valid React nodes");
  }

  const type = child.type;
  const props = child.props as Record<string, unknown>;
  if (type === React.Fragment) {
    claimRscRenderNode(budget, depth);
    return {
      type: "fragment",
      children: await renderBoundaryChildrenWithBudget(
        readChildrenProp(props),
        clientManifest,
        clientRefs,
        reactVersion,
        budget,
        depth + 1,
      ),
    };
  }

  if (typeof type === "string") {
    claimRscRenderNode(budget, depth);
    return {
      type: "server",
      component: type,
      props: serializeProps(props),
      children: await renderBoundaryChildrenWithBudget(
        readChildrenProp(props),
        clientManifest,
        clientRefs,
        reactVersion,
        budget,
        depth + 1,
      ),
    };
  }

  if (typeof type === "function") {
    const Component = type as RSCComponent;
    if (isClientComponent(Component, clientManifest)) {
      claimRscRenderNode(budget, depth);
      const componentId = getComponentId(Component);
      registerClientRef(componentId, Component, clientManifest, clientRefs);
      return {
        type: "client",
        component: componentId,
        props: serializeProps(props),
        children: await renderBoundaryChildrenWithBudget(
          readChildrenProp(props),
          clientManifest,
          clientRefs,
          reactVersion,
          budget,
          depth + 1,
        ),
      };
    }

    const rendered = Component.prototype?.render
      ? new (Component as React.ComponentClass<RSCComponentProps>)(props).render()
      : await (Component as React.FC<RSCComponentProps>)(props);
    const renderedChildren = await renderBoundaryChildrenWithBudget(
      rendered,
      clientManifest,
      clientRefs,
      reactVersion,
      budget,
      depth + 1,
    );
    if (renderedChildren.length === 1) return renderedChildren[0]!;
    claimRscRenderNode(budget, depth);
    return { type: "fragment", children: renderedChildren };
  }

  const html = await renderToStringAdapter(child, { reactVersion });
  return createHtmlNode(html, budget, depth);
}

function createHtmlNode(
  html: string,
  budget: RscRenderBudget,
  depth: number,
): RSCNode {
  claimRscRenderNode(budget, depth);
  return { type: "html", html };
}

function collectReactChildren(
  children: React.ReactNode,
  budget: RscRenderBudget,
  depth: number,
): React.ReactNode[] {
  const collected: React.ReactNode[] = [];
  React.Children.forEach(children, (child) => {
    if (child == null) return;
    if (collected.length >= MAX_RSC_RENDER_NODES - budget.nodes) {
      assertRscRenderCapacity(budget, collected.length + 1, depth);
    }
    collected.push(child);
  });
  assertRscRenderCapacity(budget, collected.length, depth);
  return collected;
}

function readChildrenProp(props: Record<string, unknown>): React.ReactNode {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(props, "children");
  } catch {
    throw new TypeError("RSC children could not be inspected safely");
  }
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, "value")) {
    throw new TypeError("RSC children must be supplied as a data property");
  }
  return descriptor.value as React.ReactNode;
}
