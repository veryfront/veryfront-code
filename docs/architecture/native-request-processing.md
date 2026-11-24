# Native request processing on Node

The service request helper and application-request sanitizers preserve native Request and Headers behavior for clean host inputs. When Node's selected native processing dependencies change after framework initialization, these paths throw a TypeError before the protected operation. They do not dispatch a request with missing headers or replace a failure with a successful response.

The preconditions inspect Function.prototype.call and the native Headers iterator protocol without invoking accessors. Request construction also rejects ambient RequestInit fields on Object.prototype. Options inherited from a custom prototype remain supported. An existing native Request passed without init remains unchanged; its headers are not enumerated to manufacture defaults.

Framework-invoked option conversion is followed by another check before native construction or header iteration. Application sanitization checks before cloning and copying, and hosted invocation preparation removes infrastructure headers before native HeadersInit conversion. It checks native state again after payload serialization and before constructing the application request. Request bodies, content types, native transfer semantics and host error identity retain their ordinary behavior. Node instrumentation that replaces the checked callback, iterator or body methods will cause explicit rejection on these paths.

## Runtime invocation bodies

Hosted invocation preparation validates native body processing before it clones the invocation request, before and after the hosted parser reads the body, and before and after it reads the retained copy to build the application request. On Node, the check compares the stream, reader, controller, typed array, text codec, JSON parse, array push and promise members with the values captured at framework initialization. On every runtime, it requires that the object, array, typed array, buffer, promise and stream prototypes keep the parents they had at initialization and have no own index properties, that the array buffer and typed array constructor, slice, species and view accessors keep the values captured at initialization, that `Object.prototype` has no own `then`, and that `Promise.prototype.constructor` keeps the value captured at initialization. A failed check throws a TypeError that names the changed member before the step runs, and the route does not start detached execution.

The bounded body reader copies, measures and decodes body bytes with captured methods and returns them in null-prototype records. It checks `Promise.prototype.constructor` before it awaits each chunk read. The retained invocation copy is read with the same reader and is released on every exit.

Every bounded body read uses this reader, not only runtime invocations. If `Promise.prototype.constructor` changes after framework initialization, each of those reads throws a TypeError that names `Promise.prototype.constructor`. When many unrelated routes start to reject request bodies with that message, look for code that replaced the promise constructor.

The invocation contract reads invocation fields as own properties. It validates a copy of the parsed body made of arrays and null-prototype records, and returns the parsed invocation in null-prototype records. A field that the body leaves out is undefined for validation and for every later reader, whatever `Object.prototype` defines under that name. The copy that the schema validates carries a placeholder for each credential string, with the same length, UTF-8 size and visible-ASCII outcome. The parsed invocation carries the original values. The agent stream handler validates its stream request the same way.

## Host credentials in ingress headers

The run-scoped inference credential and the source read credential can arrive as ingress headers instead of body fields: `x-veryfront-inference-token` and `x-veryfront-source-token`. Ingress sealing takes both off the request, with the other credential headers, before any await, so application code cannot read them from the request. The hosted invocation route, the managed broker and the agent stream handler read them before they read the body and pass them to the invocation contract, which puts them in the validated copy:

| Header                                                | Body field                | Result                             |
| ----------------------------------------------------- | ------------------------- | ---------------------------------- |
| absent                                                | absent or present         | the body field, as before          |
| present                                               | absent                    | the header value                   |
| present                                               | equal to the header       | the header value                   |
| present                                               | different from the header | rejected with 400 before execution |
| present but empty or not visible ASCII, or over 16 KB | any                       | rejected with 400                  |

A header is used only when the body has a `credentials` record; it travels with the body's `authToken`. Validation messages name the field, never a value. The body fields stay accepted while control planes move to the headers.

The framework captures the compared values when its modules load, so it must load before project code.

## Ownership and limits

Host ingress owns infrastructure credentials, including inference and run-event tokens. Application-facing requests omit infrastructure-only headers. Trusted hosts must initialize the framework before loading project code and must not give project code unsanitized native request or header objects.

These preconditions mitigate specified mutable callback, iterator and ambient-default behavior. They are not a sandbox for arbitrary code in a shared JavaScript realm. They do not cover tampering before framework initialization, arbitrary private native state or other intrinsic changes, hostile native-engine behavior, or trusted handlers disclosing credentials. User conversions that alter dependencies inside a native operation are also outside this bounded check; checking before entry cannot interpose on every internal native conversion step.

A stronger credential boundary requires a trusted process that never imports project modules and transfers only sanitized data and scoped capabilities to isolated executors. The executor transport and bootstrap work is separate from these checks. Passing these regressions does not establish deployed executor isolation.

## Verification

Use isolated test processes and synthetic credentials. Check the service helper, application-request sanitizer and hosted invocation preparation, including callback/iterator changes, inherited defaults, body processing changes, compatibility, body transfer and failure controls. Run the tests on Node, Deno and Bun. Deployment verification must identify the exact installed package and source revision, rerun the synthetic probes, and record a representative authenticated hosted-run control separately.
