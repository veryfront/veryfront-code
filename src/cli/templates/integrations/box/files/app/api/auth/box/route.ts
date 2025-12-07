/**
 * Box OAuth Init
 */

import { boxConfig, createOAuthInitHandler } from "veryfront/oauth";

export const GET = createOAuthInitHandler(boxConfig);
