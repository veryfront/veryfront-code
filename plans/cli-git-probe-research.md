# Git probe classification research

The current classifier accepts a failed HEAD probe when status succeeds and no CI SHA describes the checkout. This conflates an unborn repository with timeout, abort, output-limit, corruption, and other failures. Two capture observations can then appear to disagree even though no source mutation was proved. The broad-gate trigger remains unknown; the isolated receipt test passed.

Keep the existing five-second command deadlines and fail closed. Preserve an unborn repository only after a successful symbolic HEAD probe names a branch and an exact show-ref probe proves that ref is absent. A failed rev-parse exit code alone is not proof. Keep diagnostic outcomes internal and limited to categories and numeric exit codes; never include process output, source paths, digests, environment, or commit identifiers in the witness.
