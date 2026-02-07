import { createOAuthInitHandler, xeroConfig } from "veryfront/oauth";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

export const GET = createOAuthInitHandler(xeroConfig, { tokenStore: oauthMemoryTokenStore });
