import "../../../_dnt.polyfills.js";
import "../../../_dnt.polyfills.js";
import * as dntShim from "../../../_dnt.shims.js";
import React, { useEffect, useRef } from "react";
import { collectHead } from "../head-collector.js";
function isServerEnvironment() {
    const ssrFlag = dntShim.dntGlobalThis.__VERYFRONT_SSR__;
    return ssrFlag === true || typeof dntShim.dntGlobalThis === "undefined";
}
export function Head({ children }) {
    const mountedRef = useRef(false);
    const isSSR = isServerEnvironment();
    if (isSSR && children) {
        React.Children.forEach(children, (child) => {
            if (!React.isValidElement(child))
                return;
            const { type, props } = child;
            if (typeof type !== "string" || type === "body")
                return;
            if (type === "title") {
                collectHead({ title: String(props.children ?? "") });
                return;
            }
            if (type === "meta") {
                collectHead({
                    metas: [
                        {
                            name: props.name,
                            property: props.property,
                            content: String(props.content ?? ""),
                        },
                    ],
                });
                return;
            }
            if (type === "link") {
                const link = {};
                for (const [key, value] of Object.entries(props)) {
                    if (value != null)
                        link[key] = String(value);
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
        if (!children)
            return;
        const addedElements = [];
        React.Children.forEach(children, (child) => {
            if (!React.isValidElement(child))
                return;
            const { type, props } = child;
            if (typeof type !== "string" || type === "body")
                return;
            if (type === "title") {
                document.title = String(props.children ?? "");
                return;
            }
            const element = document.createElement(type);
            for (const [key, value] of Object.entries(props)) {
                if (key === "children")
                    continue;
                let attrName = key;
                if (key === "className")
                    attrName = "class";
                else if (key === "htmlFor")
                    attrName = "for";
                if (typeof value === "boolean") {
                    if (value)
                        element.setAttribute(attrName, "");
                    continue;
                }
                if (value != null)
                    element.setAttribute(attrName, String(value));
            }
            if (typeof props.children === "string") {
                element.textContent = props.children;
            }
            element.setAttribute("data-veryfront-managed", "1");
            document.head.appendChild(element);
            addedElements.push(element);
        });
        return () => {
            for (const el of addedElements)
                el.remove();
        };
    }, [children]);
    return React.createElement("div", {
        "data-veryfront-head": "1",
        style: { display: "none" },
    });
}
