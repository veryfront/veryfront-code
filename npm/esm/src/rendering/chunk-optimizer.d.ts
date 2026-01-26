export interface ChunkAnalysis {
    pages: Map<string, PageImports>;
    sharedDeps: Map<string, number>;
    suggestedChunks: ChunkSuggestion[];
}
export interface PageImports {
    path: string;
    local: string[];
    remote: string[];
    shared: string[];
}
export interface ChunkSuggestion {
    name: string;
    deps: string[];
    pages: string[];
    benefit: number;
}
export interface ChunkManifest {
    version: string;
    chunks: Record<string, {
        deps: string[];
        size: number;
    }>;
    pages: Record<string, {
        chunks: string[];
        deps: {
            local: string[];
            remote: string[];
            shared: string[];
        };
    }>;
}
type FSLike = {
    readDir(path: string): AsyncIterable<{
        name: string;
        isFile: boolean;
        isDirectory: boolean;
    }>;
    readTextFile(path: string): Promise<string>;
};
export declare function analyzeProjectChunks(projectDir: string, fs?: FSLike): Promise<ChunkAnalysis>;
export declare function generateChunkManifest(analysis: ChunkAnalysis): ChunkManifest;
export {};
//# sourceMappingURL=chunk-optimizer.d.ts.map