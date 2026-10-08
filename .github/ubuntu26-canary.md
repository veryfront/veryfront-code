# Ubuntu 26.04 canary

Run the existing CI/CD pipeline on Ubuntu 26.04 before GitHub moves
`ubuntu-latest` to the new image. Dispatch from `main`:

```sh
gh workflow run cicd.yml --repo veryfront/veryfront-code --ref main -F ubuntu26=true
```

The boolean input defaults to false. An enabled main dispatch selects
`ubuntu-26.04` for Linux jobs and Linux binary matrix entries. Windows jobs keep
their existing image. Other events and branches keep `ubuntu-latest`.

The dispatch retains every job, step, dependency, permission, timeout and quality
gate. Existing dispatch behavior runs the full pipeline instead of reusing a
merge-queue artifact. On an RC source this includes RC publication and the normal
server pin notification. Production promotion remains a separate workflow.

For issue #2862, record the run ID, source SHA, Runner Image headers, job
conclusions and wall time. Compare against a green full-pipeline main run, not a
main run that reused merge-queue artifacts. A later green main run after the
default image rollout remains a separate acceptance observation.

Reference: <https://github.com/actions/runner-images/issues/14748>.
