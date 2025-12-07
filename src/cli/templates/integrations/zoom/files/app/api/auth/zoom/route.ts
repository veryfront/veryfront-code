/**
 * Zoom OAuth Init
 */

import { zoomConfig, createOAuthInitHandler } from "veryfront/oauth";

export const GET = createOAuthInitHandler(zoomConfig);
