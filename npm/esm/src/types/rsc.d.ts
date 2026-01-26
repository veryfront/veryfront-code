export interface RSCNode {
    type: "server" | "client" | "html" | "fragment";
    component?: string;
    props?: Record<string, unknown>;
    children?: RSCNode[];
    html?: string;
}
export interface RSCPayload {
    html: string;
    clientRefs: Record<string, string>;
    assets?: {
        css?: string[];
        js?: string[];
    };
    tree?: RSCNode;
}
export interface ClientComponentMeta {
    id: string;
    path: string;
    exports: string[];
}
export interface RSCRendererOptions {
    clientManifest: Map<string, ClientComponentMeta>;
    projectDir: string;
    mode?: "development" | "production";
}
export interface RSCHydratorOptions {
    manifestUrl?: string;
    onError?: (error: Error) => void;
}
export type ComponentType = "server" | "client" | "unknown";
export interface ComponentAnalysis {
    type: ComponentType;
    filePath: string;
    exports: string[];
    id: string;
    hasUseClient: boolean;
    hasUseServer: boolean;
}
//# sourceMappingURL=rsc.d.ts.map