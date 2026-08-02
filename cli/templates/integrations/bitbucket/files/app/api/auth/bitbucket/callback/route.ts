import { createOAuthCallbackHandler, bitbucketConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(bitbucketConfig, { tokenStore });
