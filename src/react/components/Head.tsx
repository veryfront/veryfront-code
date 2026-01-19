import React, { useEffect, useRef } from "react";
import { collectHead } from "#veryfront/react/head-collector.ts";

function isServerEnvironment(): boolean {
  const ssrFlag = (globalThis as Record<string, unknown>).__VERYFRONT_SSR__;
  if (ssrFlag === true) return true;
  if (typeof window === "undefined") return true;
  return false;
}

/**
 * Head component for declaring head elements (title, meta, link, style)
 *
 * SSR: Collects metadata via HeadCollector, renders empty wrapper.
 * Client: Adds elements to document.head via useEffect.
 *
 * Usage:
 *   <Head>
 *     <title>Page Title</title>
 *     <meta name="description" content="..." />
 *     <link rel="stylesheet" href="..." />
 *   </Head>
 */
export function Head({ children }: { children: React.ReactNode }) {
  const mountedRef = useRef(false);
  const isSSR = isServerEnvironment();

  // SSR: Collect metadata instead of rendering
  if (isSSR && children) {
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;

      const { type, props } = child;
      if (typeof type !== "string") return;
      if (type === "body") return; // Skip body elements

      if (type === "title") {
        collectHead({ title: String(props.children || "") });
      } else if (type === "meta") {
        collectHead({
          metas: [{
            name: props.name as string | undefined,
            property: props.property as string | undefined,
            content: String(props.content || ""),
          }],
        });
      } else if (type === "link") {
        const link: Record<string, string> = {};
        for (const [key, value] of Object.entries(props)) {
          if (value != null) link[key] = String(value);
        }
        collectHead({ links: [link] });
      } else if (type === "style") {
        collectHead({ styles: [String(props.children || "")] });
      }
    });
  }

  // Client: Add elements to document.head after mount
  useEffect(() => {
    mountedRef.current = true;
    if (!children) return;

    const addedElements: Element[] = [];

    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;

      const { type, props } = child;
      if (typeof type !== "string" || type === "body") return;

      if (type === "title") {
        document.title = String(props.children || "");
        return;
      }

      const element = document.createElement(type);

      for (const [key, value] of Object.entries(props)) {
        if (key === "children") continue;
        const attrName = key === "className" ? "class" : key === "htmlFor" ? "for" : key;
        if (typeof value === "boolean") {
          if (value) element.setAttribute(attrName, "");
        } else if (value != null) {
          element.setAttribute(attrName, String(value));
        }
      }

      if (props.children && typeof props.children === "string") {
        element.textContent = props.children;
      }

      element.setAttribute("data-veryfront-managed", "1");
      document.head.appendChild(element);
      addedElements.push(element);
    });

    return () => {
      addedElements.forEach((el) => el.remove());
    };
  }, [children]);

  // Render empty wrapper - no children needed since we collect metadata directly
  return React.createElement("div", {
    "data-veryfront-head": "1",
    style: { display: "none" },
  });
}
