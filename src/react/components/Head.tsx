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
        return;
      }

      if (type === "script") {
        const script: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(props)) {
          if (key === "children" || key === "dangerouslySetInnerHTML") continue;
          if (value != null) script[key] = String(value);
        }
        // Handle inline script content
        if (props.dangerouslySetInnerHTML) {
          const html = props.dangerouslySetInnerHTML as { __html?: string };
          if (html.__html) script.content = html.__html;
        } else if (typeof props.children === "string") {
          script.content = props.children;
        }
        collectHead({ scripts: [script] });
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

      // For scripts, check if already exists to avoid double execution after SSR
      if (type === "script") {
        const src = props.src as string | undefined;
        const id = props.id as string | undefined;

        // Check by id first (most reliable)
        if (id && document.getElementById(id)) {
          return;
        }
        // Check by src for external scripts
        if (src && document.querySelector(`script[src="${src}"]`)) {
          return;
        }
        // For inline scripts without id, generate hash from content
        const content = typeof props.children === "string"
          ? props.children
          : (props.dangerouslySetInnerHTML as { __html?: string })?.__html;
        if (content && !id) {
          // Simple hash: sum of char codes, then convert to base36
          let sum = 0;
          for (let i = 0; i < Math.min(content.length, 200); i++) {
            sum = ((sum << 5) - sum + content.charCodeAt(i)) | 0;
          }
          const hash = "vf" + Math.abs(sum).toString(36);
          if (document.querySelector(`script[data-vf-hash="${hash}"]`)) {
            return;
          }
          element.setAttribute("data-vf-hash", hash);
        }
      }

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
