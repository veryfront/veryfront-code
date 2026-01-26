export interface PathObject {
    root?: string;
    dir?: string;
    base?: string;
    ext?: string;
    name?: string;
}
export interface NodePathModule {
    sep: string;
    delimiter: string;
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
    dirname(path: string): string;
    basename(path: string, ext?: string): string;
    extname(path: string): string;
    isAbsolute(path: string): boolean;
    relative(from: string, to: string): string;
    normalize(path: string): string;
    parse(path: string): PathObject;
    format(pathObject: PathObject): string;
}
//# sourceMappingURL=types.d.ts.map