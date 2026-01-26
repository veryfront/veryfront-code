import "../../../_dnt.polyfills.js";
import "../../../_dnt.polyfills.js";
import React from "react";
export interface Font {
    name: string;
    variable?: string;
    weights?: Array<string | number>;
    italics?: boolean;
}
export interface GoogleFontsProps {
    fonts: Array<Font>;
}
export declare function GoogleFonts({ fonts }: GoogleFontsProps): React.ReactElement;
export default GoogleFonts;
//# sourceMappingURL=index.d.ts.map