import "../../../_dnt.polyfills.js";
import "../../../_dnt.polyfills.js";
import React from "react";
import { Head } from "../components/Head.js";
function sortMixedArray(arr) {
    return arr.sort((a, b) => {
        const numA = typeof a === "string" ? parseFloat(a) : a;
        const numB = typeof b === "string" ? parseFloat(b) : b;
        const aNaN = Number.isNaN(numA);
        const bNaN = Number.isNaN(numB);
        if (aNaN && bNaN)
            return 0;
        if (aNaN)
            return 1;
        if (bNaN)
            return -1;
        return numA - numB;
    });
}
function generateGoogleFontsParam(font) {
    const escapedName = font.name.replace(/ /g, "+");
    const sortedWeights = sortMixedArray(font.weights ?? [400]);
    let param = `family=${escapedName}:`;
    if (font.italics)
        param += "ital,";
    const weightParams = [];
    if (font.italics) {
        for (const w of sortedWeights)
            weightParams.push(`0,${w}`);
        for (const w of sortedWeights)
            weightParams.push(`1,${w}`);
    }
    else {
        for (const w of sortedWeights)
            weightParams.push(w);
    }
    return `${param}wght@${weightParams.join(";")}&display=swap`;
}
function generateGoogleFontsHref(fonts) {
    if (!fonts.length)
        return "";
    return `https://fonts.googleapis.com/css2?${fonts.map(generateGoogleFontsParam).join("&")}`;
}
function generateCssVariables(fonts) {
    const variables = fonts
        .filter((font) => font.variable)
        .map((font) => `    ${font.variable}: "${font.name}", ui-sans-serif, system-ui, sans-serif;`)
        .join("\n");
    if (!variables)
        return "";
    return `
@layer base {
  :root {
${variables}
  }
}`.trim();
}
export function GoogleFonts({ fonts = [] }) {
    const href = generateGoogleFontsHref(fonts);
    const cssVariables = generateCssVariables(fonts);
    return React.createElement(Head, null, React.createElement("link", { rel: "preconnect", href: "https://fonts.googleapis.com" }), React.createElement("link", {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
    }), href ? React.createElement("link", { href, rel: "stylesheet" }) : null, cssVariables ? React.createElement("style", null, cssVariables) : null);
}
export default GoogleFonts;
