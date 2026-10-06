# Proxy sign-in configuration

Set `VERYFRONT_PROXY_SIGN_IN_ORIGIN` to the HTTPS origin of your Studio when you
operate Veryfront on your own domain. For example, use
`https://platform.example.test`. The value must contain no credentials, path,
query or fragment. Configure it in the operator process environment before startup;
project dotenv values are ignored. Invalid values fail initialization. Restart
the proxy after changing this setting.

The proxy sends unauthenticated protected-environment requests to `/sign-in` on
this configured origin. The `from` parameter contains an absolute project URL
only when the routed Host is the configured hostname or its subdomain.
The return URL uses HTTPS and the configured port. Other request hostnames use a
sanitized relative return path. Request credentials and ports do not determine
the redirect destination. Trusted project hosts must also serve HTTPS on the
configured port. If Studio and project hosts use different ports, the return URL
can point to a project port that does not serve the project.

Configure API and Studio cookie domains and redirect validation for the same
customer domain. Verify sign-in and the return to a protected project in a browser.
This setting does not configure those services or authorize custom domains outside
the configured domain.

If you omit the setting, the proxy retains its hosted sign-in behavior for
`veryfront.com` and `veryfront.org`.
