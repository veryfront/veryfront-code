interface InjectorOptions {
    /** Prefix for generated selectors */
    prefix?: string;
    /** Elements to skip (in addition to defaults) */
    skipElements?: string[];
    /** Only inject into elements within this selector */
    rootSelector?: string;
}
/** Inject data-vf-selector attributes into HTML for Studio Navigator */
export declare function injectElementSelectors(html: string, options?: InjectorOptions): string;
/** Check if Studio embed mode is enabled from URL */
export declare function isStudioEmbed(url: URL | string): boolean;
export {};
//# sourceMappingURL=element-selector-injector.d.ts.map