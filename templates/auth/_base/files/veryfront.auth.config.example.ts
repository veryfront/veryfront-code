import { defineConfig } from "veryfront";

export default defineConfig({
  security: {
    auth: {
      oidc: {
        issuerEnvVar: "OIDC_ISSUER",
        clientIdEnvVar: "OIDC_CLIENT_ID",
        clientSecretEnvVar: "OIDC_CLIENT_SECRET",
        sessionSecretEnvVar: "VERYFRONT_AUTH_SESSION_SECRET",
        scopes: ["openid", "profile", "email", "groups"],
        claims: {
          email: "email",
          name: "name",
          groups: "groups",
          roles: "roles",
        },
      },
    },
  },
});
