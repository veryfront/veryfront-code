/**
 * Declarative `<head>` metadata management.
 *
 * @module head
 *
 * @example
 * ```tsx
 * import { Head } from "veryfront/head";
 *
 * export default function Page() {
 *   return (
 *     <>
 *       <Head>
 *         <title>My Page</title>
 *         <meta name="description" content="Page description" />
 *       </Head>
 *       <main>Content</main>
 *     </>
 *   );
 * }
 * ```
 */
import React, { useEffect, useRef } from "react";
import { collectHead } from "#veryfront/react/head-collector.ts";
import { isServerEnvironment } from "#veryfront/platform/compat/runtime.ts";

export function Head({ children }: { children: React.ReactNode }): React.ReactElement {
  const mountedRef = useRef(false);
  const isSSR = isServerEnvironment();

  if (isSSR && children) {
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
