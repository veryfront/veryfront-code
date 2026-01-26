import { type RuntimeEnv } from "../../config/runtime-env.js";
import { deleteToken, hasToken, readToken, saveToken } from "./token-store.js";
export type AuthMethod = "google" | "github" | "microsoft" | "token";
export interface UserInfo {
    id: string;
    email: string;
    name?: string;
}
export declare function validateToken(token: string): Promise<UserInfo | null>;
export declare function login(method?: AuthMethod): Promise<UserInfo | null>;
export declare function ensureAuthenticated(env?: RuntimeEnv): Promise<UserInfo | null>;
export declare function logout(): Promise<void>;
export declare function whoami(env?: RuntimeEnv): Promise<UserInfo | null>;
export { deleteToken, hasToken, readToken, saveToken };
//# sourceMappingURL=login.d.ts.map