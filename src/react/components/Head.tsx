import React from "react";
import { collectHead } from "#veryfront/react/head-collector.ts";
import { isServerEnvironment } from "#veryfront/platform/compat/runtime.ts";

/**
 * Processes head children and collects metadata for SSR.
 * This function is pure and doesn't use any React hooks.
 */
function collectHeadFromChildren(children: React.ReactNode): void {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;

    const { type } = child;
    // Cast props to Record for React 19 compatibility (props is unknown in R19 types)
    const props = child.props as Record<string, unknown>;
    if (typeof type !== "string" || type === "body") return;

    if (type === "title") {
      collectHead({ title: String(props.children ?? "") });
      return;
    }

    if (type === "meta") {
      collectHead({
        metas: [
          {
            name: props.name as string | undefined,
            property: props.property as string | undefined,
            content: String(props.content ?? ""),
          },
        ],
      });
      return;
    }

    if (type === "link") {
      const link: Record<string, string> = {};
      for (const [key, value] of Object.entries(props)) {
        if (value != null) link[key] = String(value);
      }
      collectHead({ links: [link] });
      return;
    }

    if (type === "style") {
      collectHead({ styles: [String(props.children ?? "")] });
    }
  });
}

/**
 * SSR-only Head component that collects metadata without hooks.
 * Returns a placeholder div that will be hydrated on the client.
 */
function HeadSSR({ children }: { children: React.ReactNode }): React.ReactElement {
  if (children) {
    collectHeadFromChildren(children);
  }
  return React.createElement("div", {
    "data-veryfront-head": "1",
    style: { display: "none" },
  });
}

/**
 * Client-side Head component with hooks for DOM manipulation.
 * This is only used in browser environments where hooks work correctly.
 */
function HeadClient({ children }: { children: React.ReactNode }): React.ReactElement {
  // These imports are dynamically loaded to avoid issues during SSR
  // where the React instance may differ between renderer and user code
  const { useEffect, useRef } = React;

  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    if (!children) return;

    const addedElements: Element[] = [];

    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;

      const { type } = child;
      // Cast props to Record for React 19 compatibility (props is unknown in R19 types)
      const props = child.props as Record<string, unknown>;
      if (typeof type !== "string" || type === "body") return;

      if (type === "title") {
        document.title = String(props.children ?? "");
        return;
      }

      const element = document.createElement(type);

      for (const [key, value] of Object.entries(props)) {
        if (key === "children") continue;

        let attrName = key;
        if (key === "className") attrName = "class";
        else if (key === "htmlFor") attrName = "for";

        if (typeof value === "boolean") {
          if (value) element.setAttribute(attrName, "");
          continue;
        }

        if (value != null) element.setAttribute(attrName, String(value));
      }

      if (typeof props.children === "string") {
        element.textContent = props.children;
      }

      element.setAttribute("data-veryfront-managed", "1");
      document.head.appendChild(element);
      addedElements.push(element);
    });

    return () => {
      for (const el of addedElements) el.remove();
    };
  }, [children]);

  return React.createElement("div", {
    "data-veryfront-head": "1",
    style: { display: "none" },
  });
}

/**
 * Head component for managing document head elements (title, meta, link, style).
 *
 * During SSR, this component collects head metadata without using React hooks
 * to avoid React instance mismatch issues between renderer and user code.
 *
 * On the client, it uses hooks to dynamically manage head elements.
 */
export function Head({ children }: { children: React.ReactNode }): React.ReactElement {
  // Check SSR at the top level, before any hooks are called
  // This avoids the React instance mismatch issue during SSR
  if (isServerEnvironment()) {
    return HeadSSR({ children });
  }
  return HeadClient({ children });
}
