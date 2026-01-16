import React, { useEffect, useRef } from "react";

// Detect SSR vs browser environment
const isServer = typeof window === "undefined";

/**
 * Head component for declaring head elements (title, meta, link, etc.)
 *
 * Works with React 19's native document metadata support.
 *
 * SSR PHASE:
 * 1. Renders hidden div with children: <div data-veryfront-head><title>...</title></div>
 * 2. extractHeadElements() parses title/description and passes to shell generator
 * 3. Shell generator uses extracted title (overrides frontmatter default)
 * 4. Remaining elements injected before </head>
 * 5. Wrapper left empty: <div data-veryfront-head></div>
 *
 * HEAD RECONCILIATION:
 * - Title from <Head> overrides frontmatter title (no duplicates)
 * - Description from <Head> overrides frontmatter description
 * - Other meta tags (og:*, twitter:*) are injected alongside frontmatter meta
 *
 * CLIENT PHASE:
 * 1. Initial render: empty wrapper (matches SSR cleaned output) - no hydration mismatch
 * 2. After mount: useEffect adds elements directly to document.head
 * 3. React 19 handles subsequent updates to title/meta natively
 *
 * CSR NAVIGATION:
 * - Server-rendered HTML includes children in wrapper
 * - applyHeadDirectives() (dom-utils.ts) extracts and applies to document.head
 */
export function Head({ children }: { children: React.ReactNode }) {
  const mountedRef = useRef(false);

  // After mount, add head elements directly to document.head
  useEffect(() => {
    mountedRef.current = true;

    if (!children) return;

    // Convert children to DOM elements and add to head
    const childArray = React.Children.toArray(children);
    const addedElements: Element[] = [];

    childArray.forEach((child) => {
      if (!React.isValidElement(child)) return;

      const { type, props } = child;
      if (typeof type !== "string") return;

      // Skip body elements (invalid in head)
      if (type === "body") return;

      // Handle title specially
      if (type === "title") {
        document.title = props.children || "";
        return;
      }

      // Create DOM element
      const element = document.createElement(type);

      // Set attributes
      Object.entries(props).forEach(([key, value]) => {
        if (key === "children") return;
        if (key === "className") {
          element.setAttribute("class", String(value));
        } else if (key === "htmlFor") {
          element.setAttribute("for", String(value));
        } else if (typeof value === "boolean") {
          if (value) element.setAttribute(key, "");
        } else if (value != null) {
          element.setAttribute(key, String(value));
        }
      });

      // Set text content if any
      if (props.children && typeof props.children === "string") {
        element.textContent = props.children;
      }

      // Mark as managed by veryfront for cleanup
      element.setAttribute("data-veryfront-managed", "1");

      document.head.appendChild(element);
      addedElements.push(element);
    });

    // Cleanup on unmount
    return () => {
      addedElements.forEach((el) => el.remove());
    };
  }, [children]);

  // SSR: Render wrapper WITH children (for extraction to <head>)
  // Client: Render EMPTY wrapper (matches SSR after extraction)
  // This ensures hydration sees matching empty wrappers on both sides
  return React.createElement(
    "div",
    {
      "data-veryfront-head": "1",
      style: { display: "none" },
    },
    isServer ? children : null,
  );
}
