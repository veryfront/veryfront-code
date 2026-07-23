# Domain Glossary

Terms with a specific meaning in this codebase. Architecture reviews and
refactors should use these names; sharpen or extend this file as concepts
crystallize.

## Stream Outcome

How a provider stream ended, interpreted in exactly one place:
`src/agent/streaming/stream-outcome.ts`. Covers extracting an error message
from whatever a provider throws, recognizing the late "body read" failure
(which counts as completion when output already streamed), classifying finish
reasons as completed steps, and mapping thrown errors to known terminal
provider errors. The agent **runtime** layer starts streams and the **hosted**
layer finishes them — both consult this module rather than re-deriving the
interpretation, so provider behavior changes land in one file.
