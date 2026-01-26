import * as esbuild from "esbuild";
export async function transpileCode(code, options) {
    const { code: transformedCode } = await esbuild.transform(code, {
        loader: "jsx",
        jsx: "automatic",
        jsxImportSource: "react",
        format: "esm",
        target: options.mode === "development" ? "es2020" : "es2018",
        minify: options.mode === "production",
    });
    return transformedCode;
}
