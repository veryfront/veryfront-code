# Upload image runtime evidence

## Staging source conversation
- URL: https://veryfront.org/projects/jjj-ab2510f8?panels=chat&conversation_id=835c40af-01f0-4841-94f6-f0710e6fd571
- Conversation: `835c40af-01f0-4841-94f6-f0710e6fd571`
- Project: `jjj-ab2510f8` / `7bd19a01-8486-4be3-a73a-80975654b684`
- User: `kentaro@codersociety.com`
- User message stores an uploaded image part:
  - `type=image`
  - `upload_id=f511afb2-9c79-4d11-9555-f588a1f4661a`
  - `media_type=image/jpeg`
  - URL path `/api/projects/7bd19a01-8486-4be3-a73a-80975654b684/uploads/f511afb2-9c79-4d11-9555-f588a1f4661a`
- Upload row points at a JPEG (`size=46311`) in `_chat/...jpeg`.
- Browser evidence shows the uploaded image is a web-app screenshot, while the assistant answered with an unrelated animal description.

## Root cause
Persisted image upload parts use snake_case (`upload_id`, `media_type`) and `type: "image"`. The runtime URL refresh and provider prompt conversion only handled camelCase `file` parts, then converted the final runtime prompt to text-only. The model received `What is this?` without native image content.

## Fix verified locally
- Runtime URL refresh now handles `file` and `image`, plus camelCase and snake_case upload fields.
- Text-generation runtime keeps native image/file parts while retaining readable `<uploaded_files>` text context.
- Anthropic, Google, OpenAI Chat Completions, and OpenAI Responses emit provider-native image URL payloads.
- Focused tests and provider typed tests pass locally.
