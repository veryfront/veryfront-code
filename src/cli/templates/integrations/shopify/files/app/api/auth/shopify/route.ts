/**
 * Shopify OAuth Init
 */

import { shopifyConfig, createOAuthInitHandler } from "veryfront/oauth";

export const GET = createOAuthInitHandler(shopifyConfig);
