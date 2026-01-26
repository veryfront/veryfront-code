import React from "react";
export function generateBlurDataURL(width = 10, height = 10, color = "#cccccc") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
}
export function getAspectRatioPadding(width, height) {
    return `${(height / width) * 100}%`;
}
export function ResponsiveImageContainer({ width, height, children, className, style, }) {
    const containerStyle = {
        position: "relative",
        width: "100%",
        paddingBottom: getAspectRatioPadding(width, height),
        ...style,
    };
    const contentStyle = {
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
    };
    return (React.createElement("div", { className: className, style: containerStyle },
        React.createElement("div", { style: contentStyle }, children)));
}
