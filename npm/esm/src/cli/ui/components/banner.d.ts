import { BORDER_STYLES } from "../box.js";
export interface BannerInfo {
    url?: string;
    project?: string;
    port?: number;
    [key: string]: string | number | undefined;
}
export interface BannerOptions {
    /** Title text (default: "Veryfront") */
    title?: string;
    /** Subtitle text */
    subtitle?: string;
    /** Key-value info to display */
    info?: BannerInfo;
    /** Border style (default: "rounded") */
    style?: keyof typeof BORDER_STYLES;
    /** Minimum width */
    minWidth?: number;
    /** Show the dot matrix logo */
    showLogo?: boolean;
}
export declare function banner(options?: BannerOptions): string;
export declare function inlineBanner(options?: BannerOptions): string;
export declare function errorBanner(message: string, suggestion?: string): string;
export declare function successBanner(message: string, info?: BannerInfo): string;
//# sourceMappingURL=banner.d.ts.map