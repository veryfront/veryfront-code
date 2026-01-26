export function minifyCSS(css) {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ")
        .replace(/\s*([{}:;,])\s*/g, "$1")
        .trim();
}
export function countUtilities(css) {
    const matches = css.match(/\.[a-zA-Z0-9_-]+/g);
    return matches ? new Set(matches).size : 0;
}
