/**
 * QuickBooks OAuth Init
 */

import { quickbooksConfig, createOAuthInitHandler } from "veryfront/oauth";

export const GET = createOAuthInitHandler(quickbooksConfig);
