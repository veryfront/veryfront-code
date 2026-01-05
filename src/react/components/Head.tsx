import React, { useEffect, useRef } from "react";

// Detect SSR vs browser environment
const isServer = typeof window === "undefined";

/**
 * Head component for declaring head elements (title, meta, link, etc.)
 *
 * HYDRATION FIX: This component uses environment-aware rendering:
 *
 * SSR Phase:
 * 1. Renders hidden div with children: <div data-veryfront-head><link>...</div>
 * 2. extractHeadElements() moves children to actual <head>
 * 3. Leaves empty wrapper: <div data-veryfront-head></div>
 *
 * Client Phase:
 * 1. Initial render: empty wrapper (matches SSR cleaned output) - no hydration mismatch
 * 2. After mount: useEffect adds elements directly to document.head
 *
 * This ensures:
 * - Head elements are in <head> during SSR (SEO, preloading)
 * - Hydration succeeds (empty wrapper matches both sides)
 * - Client-side navigation works via applyHeadDirectives() in dom-utils.ts
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
