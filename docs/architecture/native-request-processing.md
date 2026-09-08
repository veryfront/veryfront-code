# Native request processing on Node

The service request helper and application-request sanitizers preserve native Request and Headers behavior for clean host inputs. When Node's selected native processing dependencies change after framework initialization, these paths throw a TypeError before the protected operation. They do not dispatch a request with missing headers or replace a failure with a successful response.

The preconditions inspect Function.prototype.call and the native Headers iterator protocol without invoking accessors. Request construction also rejects ambient RequestInit fields on Object.prototype. Options inherited from a custom prototype remain supported. An existing native Request passed without init remains unchanged; its headers are not enumerated to manufacture defaults.

Framework-invoked option conversion is followed by another check before native construction or header iteration. Application sanitization checks before cloning and copying, and hosted invocation preparation removes infrastructure headers before native HeadersInit conversion. It checks native state again after payload serialization and before constructing the application request. Request bodies, content types, native transfer semantics and host error identity retain their ordinary behavior. Node instrumentation that replaces the checked callback or iterator methods will cause explicit rejection on these paths.

## Ownership and limits

Host ingress owns infrastructure credentials, including inference and run-event tokens. Application-facing requests omit infrastructure-only headers. Trusted hosts must initialize the framework before loading project code and must not give project code unsanitized native request or header objects.

These preconditions mitigate specified mutable callback, iterator and ambient-default behavior. They are not a sandbox for arbitrary code in a shared JavaScript realm. They do not cover tampering before framework initialization, arbitrary private native state or other intrinsic changes, hostile native-engine behavior, or trusted handlers disclosing credentials. User conversions that alter dependencies inside a native operation are also outside this bounded check; checking before entry cannot interpose on every internal native conversion step.

A stronger credential boundary requires a trusted process that never imports project modules and transfers only sanitized data and scoped capabilities to isolated executors. The executor transport and bootstrap work is separate from these checks. Passing these regressions does not establish deployed executor isolation.

## Verification

Use isolated test processes and synthetic credentials. Check the service helper, application-request sanitizer and hosted invocation preparation, including callback/iterator changes, inherited defaults, compatibility, body transfer and failure controls. Run the tests on Node, Deno and Bun. Deployment verification must identify the exact installed package and source revision, rerun the synthetic probes, and record a representative authenticated hosted-run control separately.
