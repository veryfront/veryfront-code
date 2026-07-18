---
name: deploy-safely
description: Build, test, push, deploy, and verify with rollback through Git on failure.
metadata:
  version: "1.0.0"
---

# Deploy Safely

Build and test the reviewed Git source, then push it to Veryfront before creating a release and deployment. If verification fails, revert the Git commit and run the normal delivery sequence again.

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
   veryfront push --branch <branch> --yes
   ```
   Abort if any file fails to upload.

4. **Deploy**
   ```bash
   veryfront deploy --env <environment> --branch <branch> --yes --json
   ```
   Record the project, environment, release, deployment, and commit IDs from the final result record.

5. **Verify health** (via MCP)
   Use `vf_get_errors` to check for runtime errors after deploy.
   Wait 30 seconds, then check again.

6. **Confirm or rollback**
   - If no errors: deployment is successful
   - If errors are detected, create and push a Git revert:
     ```bash
     git revert <bad-commit>
     git push origin <branch>
     ```
   - Let CI run the normal Push and Deploy steps for the revert. Without CI, repeat steps 3 and 4 manually.

## Error Recovery

- **Build fails**: Check `vf_get_errors` for compilation errors, fix and retry
- **Tests fail**: Read the JSON output and fix failing tests
- **Push fails**: Fix the upload failure and rerun Push before Deploy
- **Deploy fails**: Check environment name, auth token, branch existence
- **Post-deploy errors**: Revert the failing Git commit, push the revert, then run the normal Push and Deploy sequence
