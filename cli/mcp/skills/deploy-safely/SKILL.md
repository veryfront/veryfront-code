---
name: deploy-safely
description: Build, test, deploy, and verify with rollback on failure.
metadata:
  version: "1.0.0"
---

# Deploy Safely

Build, test, deploy, and verify with rollback on failure.

## Steps

1. **Build**
   ```bash
   veryfront build --json
   ```
   Abort if `success: false`.

2. **Run tests**
   ```bash
   veryfront test --json
   ```
   Abort if any test fails.

3. **Push**
   ```bash
   veryfront push --branch <branch> --force
   ```
   Abort if any file fails to upload.

4. **Deploy**
   ```bash
   veryfront deploy --env <environment> --branch <branch> --yes --json
   ```
   Record the project, environment, release, deployment, and commit IDs from the response.

5. **Verify health** (via MCP)
   Use `vf_get_errors` to check for runtime errors after deploy.
   Wait 30 seconds, then check again.

6. **Confirm or rollback**
   - If no errors: deployment is successful
   - If errors detected: deploy the previous version

## Error Recovery

- **Build fails**: Check `vf_get_errors` for compilation errors, fix and retry
- **Tests fail**: Read failure details from JSON output, fix failing tests
- **Push fails**: Fix failed uploads before retrying deploy
- **Deploy fails**: Check environment name, auth token, branch existence
- **Post-deploy errors**: Redeploy previous release with `--release-name <previous>`
