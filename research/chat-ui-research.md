 Chat UI Gap Analysis: Veryfront vs assistant-ui vs Vercel AI Elements

  Architecture Comparison

  ┌──────────────┬──────────────────────────┬───────────────────────────┬─────────────────────────┐
  │  Dimension   │   Veryfront (current)    │       assistant-ui        │   Vercel AI Elements    │
  ├──────────────┼──────────────────────────┼───────────────────────────┼─────────────────────────┤
  │ Pattern      │ Monolithic <Chat/> +     │ Headless primitives +     │ Composable compound     │
  │              │ primitives               │ owned styled layer        │ components (owned)      │
  ├──────────────┼──────────────────────────┼───────────────────────────┼─────────────────────────┤
  │ Distribution │ Framework-embedded       │ npm packages + CLI        │ CLI install             │
  │              │ (veryfront/chat)         │ install                   │ (shadcn-style)          │
  ├──────────────┼──────────────────────────┼───────────────────────────┼─────────────────────────┤
  │ Styling      │ Tailwind + theme object  │ Tailwind + CSS vars       │ Tailwind + CSS vars     │
  │              │ merge                    │ (shadcn)                  │ (shadcn)                │
  ├──────────────┼──────────────────────────┼───────────────────────────┼─────────────────────────┤
  │ State        │ useChat hook (custom)    │ Custom signal-based       │ Vercel AI SDK useChat   │
  │              │                          │ reactive (tap)            │ directly                │
  ├──────────────┼──────────────────────────┼───────────────────────────┼─────────────────────────┤
  │ Backend      │ createChatHandler        │ Runtime adapters (AI SDK, │ AI SDK server routes    │
  │              │ (framework)              │  LangGraph, etc.)         │                         │
  ├──────────────┼──────────────────────────┼───────────────────────────┼─────────────────────────┤
  │ Streaming    │ Custom SSE protocol      │ assistant-stream protocol │ AI SDK UIMessageStream  │
  └──────────────┴──────────────────────────┴───────────────────────────┴─────────────────────────┘

  ---
  Component Coverage Matrix

  Core Chat Components

  ┌───────────────┬─────────────────────────┬────────────────────────────┬────────────────────────┐
  │   Component   │        Veryfront        │        assistant-ui        │      AI Elements       │
  ├───────────────┼─────────────────────────┼────────────────────────────┼────────────────────────┤
  │ Chat          │ <Chat/>,                │                            │                        │
  │ container /   │ <ChatContainer/>        │ ThreadPrimitive.Root       │ <Conversation>         │
  │ Thread root   │                         │                            │                        │
  ├───────────────┼─────────────────────────┼────────────────────────────┼────────────────────────┤
  │ Message list  │ <MessageList/>          │ ThreadPrimitive.Viewport + │ <ConversationContent>  │
  │ (scrollable)  │ (aria-live)             │  Messages                  │                        │
  ├───────────────┼─────────────────────────┼────────────────────────────┼────────────────────────┤
  │ Auto-scroll   │ Built into <Chat/>      │ ThreadPrimitive.Viewport   │ Built into             │
  │ to bottom     │                         │ (built-in)                 │ <Conversation>         │
  ├───────────────┼─────────────────────────┼────────────────────────────┼────────────────────────┤
  │ Scroll-to-bot │ <ConversationScrollButt │ ThreadPrimitive.ScrollToBo │ <ConversationScrollBut │
  │ tom button    │ on/>                    │ ttom                       │ ton>                   │
  ├───────────────┼─────────────────────────┼────────────────────────────┼────────────────────────┤
  │ Single        │                         │                            │                        │
  │ message       │ <MessageItem/>          │ MessagePrimitive.Root      │ <Message>              │
  │ wrapper       │                         │                            │                        │
  ├───────────────┼─────────────────────────┼────────────────────────────┼────────────────────────┤
  │ Message text  │ <Markdown/>             │ MessagePrimitive.Parts →   │ <MessageResponse>      │
  │ rendering     │                         │ Text                       │ (markdown)             │
  ├───────────────┼─────────────────────────┼────────────────────────────┼────────────────────────┤
  │ Input         │ <InputBox/>             │ ComposerPrimitive.Input    │ <PromptInputTextarea>  │
  │ textarea      │ (auto-resize)           │                            │                        │
  ├───────────────┼─────────────────────────┼────────────────────────────┼────────────────────────┤
  │ Submit button │ <SubmitButton/>         │ ComposerPrimitive.Send     │ <PromptInputSubmit>    │
  ├───────────────┼─────────────────────────┼────────────────────────────┼────────────────────────┤
  │ Stop          │ Built into              │ ComposerPrimitive.Cancel   │ Via useChat status     │
  │ generation    │ <SubmitButton/>         │                            │                        │
  ├───────────────┼─────────────────────────┼────────────────────────────┼────────────────────────┤
  │ Empty state   │ <ConversationEmptyState │ ThreadPrimitive.Empty      │ <ConversationEmptyStat │
  │               │ />                      │                            │ e>                     │
  ├───────────────┼─────────────────────────┼────────────────────────────┼────────────────────────┤
  │ Suggestions   │ <Suggestions/>,         │ ThreadPrimitive.Suggestion │ <Suggestions>,         │
  │               │ <Suggestion/>           │ s                          │ <Suggestion>           │
  ├───────────────┼─────────────────────────┼────────────────────────────┼────────────────────────┤
  │ Loading       │ <LoadingIndicator/>     │ Via message status         │ <Shimmer>              │
  │ indicator     │                         │                            │                        │
  ├───────────────┼─────────────────────────┼────────────────────────────┼────────────────────────┤
  │ Error display │ Via <Chat error={}>     │ MessagePrimitive.Error     │ Custom                 │
  └───────────────┴─────────────────────────┴────────────────────────────┴────────────────────────┘

  RAG / Sources

  ┌───────────┬─────────────────────────┬───────────────────────┬─────────────────────────────────┐
  │ Component │        Veryfront        │     assistant-ui      │           AI Elements           │
  ├───────────┼─────────────────────────┼───────────────────────┼─────────────────────────────────┤
  │ Source    │ <Sources/>              │ SourceMessagePart +   │ <Sources> (collapsible)         │
  │ list      │                         │ styled Sources        │                                 │
  ├───────────┼─────────────────────────┼───────────────────────┼─────────────────────────────────┤
  │ Source    │ Extracted from tool     │ useMessagePartSource( │ <Source>                        │
  │ item      │ results                 │ )                     │                                 │
  ├───────────┼─────────────────────────┼───────────────────────┼─────────────────────────────────┤
  │ Inline    │ <InlineCitation/>       │ Source parts in       │ <InlineCitation> (hover cards)  │
  │ citations │                         │ message               │                                 │
  ├───────────┼─────────────────────────┼───────────────────────┼─────────────────────────────────┤
  │ Source ex │ extractSourcesFromParts │                       │                                 │
  │ traction  │ ()                      │ Built into runtime    │ Backend sendSources: true       │
  │ util      │                         │                       │                                 │
  ├───────────┼─────────────────────────┼───────────────────────┼─────────────────────────────────┤
  │ Reference │                         │ Via attachment        │ usePromptInputReferencedSources │
  │ d sources │ Missing                 │ adapter               │ ()                              │
  │  in input │                         │                       │                                 │
  ├───────────┼─────────────────────────┼───────────────────────┼─────────────────────────────────┤
  │ Source    │                         │                       │                                 │
  │ hover     │ Partial (tooltip only)  │ Custom via primitives │ Built-in with quotes & carousel │
  │ cards     │                         │                       │                                 │
  └───────────┴─────────────────────────┴───────────────────────┴─────────────────────────────────┘

  Tool Calls / Generative UI

  ┌─────────────────┬─────────────────────┬───────────────────────────────┬──────────────────────┐
  │    Component    │      Veryfront      │         assistant-ui          │     AI Elements      │
  ├─────────────────┼─────────────────────┼───────────────────────────────┼──────────────────────┤
  │ Tool call card  │ <ToolCallCard/>     │ MessagePrimitive.Parts →      │ <Tool>               │
  │                 │                     │ tools map                     │                      │
  ├─────────────────┼─────────────────────┼───────────────────────────────┼──────────────────────┤
  │ Tool status     │ <ToolStatusBadge/>  │ Via                           │ <ToolHeader          │
  │ badge           │                     │ ToolCallMessagePart.status    │ state={}>            │
  ├─────────────────┼─────────────────────┼───────────────────────────────┼──────────────────────┤
  │ Tool input      │ Collapsible JSON    │ Custom per tool               │ <ToolInput>          │
  │ display         │                     │                               │                      │
  ├─────────────────┼─────────────────────┼───────────────────────────────┼──────────────────────┤
  │ Tool output     │ Collapsible         │ Custom per tool               │ <ToolOutput> (React  │
  │ display         │ JSON/table          │                               │ nodes)               │
  ├─────────────────┼─────────────────────┼───────────────────────────────┼──────────────────────┤
  │ Per-tool custom │ renderTool prop     │ tools: { MyTool: Component }  │ Custom switch in     │
  │  renderer       │                     │                               │ message loop         │
  ├─────────────────┼─────────────────────┼───────────────────────────────┼──────────────────────┤
  │ Tool approval / │ Status badge only   │ requires-action status        │ <Confirmation>       │
  │  HITL           │                     │                               │ component            │
  ├─────────────────┼─────────────────────┼───────────────────────────────┼──────────────────────┤
  │ JSX preview     │ Missing             │ Via tool render               │ <JSXPreview>         │
  │                 │                     │                               │ (streaming)          │
  ├─────────────────┼─────────────────────┼───────────────────────────────┼──────────────────────┤
  │ Web preview /   │ Missing             │ Missing                       │ <WebPreview>,        │
  │ sandbox         │                     │                               │ <Sandbox>            │
  └─────────────────┴─────────────────────┴───────────────────────────────┴──────────────────────┘

  Reasoning / Chain of Thought

  ┌──────────────────────┬──────────────────┬─────────────────────────┬────────────────────────────┐
  │      Component       │    Veryfront     │      assistant-ui       │        AI Elements         │
  ├──────────────────────┼──────────────────┼─────────────────────────┼────────────────────────────┤
  │ Reasoning card       │ <ReasoningCard/> │ ChainOfThoughtPrimitive │ <Reasoning>                │
  ├──────────────────────┼──────────────────┼─────────────────────────┼────────────────────────────┤
  │ Collapsible thinking │ Yes              │ Accordion-based         │ Auto-open during stream    │
  ├──────────────────────┼──────────────────┼─────────────────────────┼────────────────────────────┤
  │ Multi-step chain of  │ Missing          │ Parts grouping          │ <ChainOfThought> with      │
  │ thought              │                  │                         │ steps                      │
  ├──────────────────────┼──────────────────┼─────────────────────────┼────────────────────────────┤
  │ Step status          │ Missing          │ Missing                 │ Complete/active/pending    │
  │ indicators           │                  │                         │ states                     │
  └──────────────────────┴──────────────────┴─────────────────────────┴────────────────────────────┘

  Attachments / File Upload

  ┌─────────────┬──────────────────┬──────────────────────────────────┬───────────────────────────┐
  │  Component  │    Veryfront     │           assistant-ui           │        AI Elements        │
  ├─────────────┼──────────────────┼──────────────────────────────────┼───────────────────────────┤
  │ File upload │ onAttach prop    │ ComposerPrimitive.AddAttachment  │ PromptInputActionMenu     │
  │  button     │                  │                                  │                           │
  ├─────────────┼──────────────────┼──────────────────────────────────┼───────────────────────────┤
  │ Attachment  │ attachments prop │ ComposerPrimitive.Attachments    │ PromptInputAttachmentsDis │
  │ pills       │                  │                                  │ play                      │
  ├─────────────┼──────────────────┼──────────────────────────────────┼───────────────────────────┤
  │ Remove      │ onRemoveAttachme │ AttachmentPrimitive.Remove       │ Remove button on hover    │
  │ attachment  │ nt               │                                  │                           │
  ├─────────────┼──────────────────┼──────────────────────────────────┼───────────────────────────┤
  │ Drag-and-dr │ Missing          │ ComposerPrimitive.AttachmentDrop │ globalDrop prop           │
  │ op zone     │                  │ zone                             │                           │
  ├─────────────┼──────────────────┼──────────────────────────────────┼───────────────────────────┤
  │ Upload      │ Status:          │ PendingAttachment.progress       │ Via attachment state      │
  │ progress    │ uploading/ready  │                                  │                           │
  ├─────────────┼──────────────────┼──────────────────────────────────┼───────────────────────────┤
  │ Attachment  │ Missing          │ AttachmentPrimitive.unstable_Thu │ Image thumbnails          │
  │ preview     │                  │ mb                               │                           │
  ├─────────────┼──────────────────┼──────────────────────────────────┼───────────────────────────┤
  │ In-message  │ Missing          │ MessagePrimitive.Attachments     │ <MessageAttachments>      │
  │ attachments │                  │                                  │                           │
  └─────────────┴──────────────────┴──────────────────────────────────┴───────────────────────────┘

  Message Actions

  ┌──────────────┬─────────────────┬─────────────────────────────────────────┬─────────────────────┐
  │  Component   │    Veryfront    │              assistant-ui               │     AI Elements     │
  ├──────────────┼─────────────────┼─────────────────────────────────────────┼─────────────────────┤
  │ Copy message │ <MessageActions │ ActionBarPrimitive.Copy                 │ <MessageAction      │
  │              │ /> (copy)       │                                         │ label="Copy">       │
  ├──────────────┼─────────────────┼─────────────────────────────────────────┼─────────────────────┤
  │ Regenerate   │ reload()        │ ActionBarPrimitive.Reload               │ Via useChat         │
  │              │ function only   │                                         │                     │
  ├──────────────┼─────────────────┼─────────────────────────────────────────┼─────────────────────┤
  │ Edit message │ Missing         │ ActionBarPrimitive.Edit + EditComposer  │ Missing             │
  ├──────────────┼─────────────────┼─────────────────────────────────────────┼─────────────────────┤
  │ Message      │ Missing         │ BranchPickerPrimitive (prev/next/count) │ <MessageBranch>     │
  │ branching    │                 │                                         │                     │
  ├──────────────┼─────────────────┼─────────────────────────────────────────┼─────────────────────┤
  │ Thumbs       │ Missing         │ ActionBarPrimitive.FeedbackPositive/Neg │ Missing             │
  │ up/down      │                 │ ative                                   │                     │
  ├──────────────┼─────────────────┼─────────────────────────────────────────┼─────────────────────┤
  │ Export       │ Missing         │ ActionBarPrimitive.ExportMarkdown       │ <ConversationDownlo │
  │ markdown     │                 │                                         │ ad>                 │
  ├──────────────┼─────────────────┼─────────────────────────────────────────┼─────────────────────┤
  │ Text-to-spee │ Missing         │ ActionBarPrimitive.Speak/StopSpeaking   │ Missing             │
  │ ch           │                 │                                         │                     │
  └──────────────┴─────────────────┴─────────────────────────────────────────┴─────────────────────┘

  Voice

  ┌───────────────────┬──────────────────┬───────────────────────────────────────┬─────────────────┐
  │     Component     │    Veryfront     │             assistant-ui              │   AI Elements   │
  ├───────────────────┼──────────────────┼───────────────────────────────────────┼─────────────────┤
  │ Voice input       │ useVoiceInput    │ ComposerPrimitive.Dictate             │ <SpeechInput>   │
  │                   │ hook             │                                       │                 │
  ├───────────────────┼──────────────────┼───────────────────────────────────────┼─────────────────┤
  │ Audio player      │ Missing          │ Missing                               │ <AudioPlayer>   │
  ├───────────────────┼──────────────────┼───────────────────────────────────────┼─────────────────┤
  │ Mic selector      │ Missing          │ Missing                               │ <MicSelector>   │
  ├───────────────────┼──────────────────┼───────────────────────────────────────┼─────────────────┤
  │ Transcription     │ Missing          │ ComposerPrimitive.DictationTranscript │ <Transcription> │
  │ display           │                  │                                       │                 │
  └───────────────────┴──────────────────┴───────────────────────────────────────┴─────────────────┘

  Advanced / Unique

  ┌────────────────┬───────────────────────────────────┬──────────────────────┬───────────────────┐
  │   Component    │             Veryfront             │     assistant-ui     │    AI Elements    │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Model selector │ <ModelSelector/>                  │ Via styled component │ <ModelSelector>   │
  │                │                                   │                      │ (with logos)      │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Inference      │ <InferenceBadge/>                 │ Missing              │ Missing           │
  │ badge          │                                   │                      │                   │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Browser        │ Full browser inference            │ Missing              │ Missing           │
  │ fallback       │                                   │                      │                   │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Upgrade CTA    │ <UpgradeCTA/>                     │ Missing              │ Missing           │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Thread list /  │ Missing                           │ ThreadListPrimitive  │ Missing           │
  │ sidebar        │                                   │ (full CRUD)          │                   │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Thread         │ Missing                           │ Archive, delete,     │ Missing           │
  │ management     │                                   │ rename               │                   │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Conversation   │ Missing                           │ Missing              │ <Checkpoint>      │
  │ checkpoints    │                                   │                      │                   │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Token/context  │ Missing                           │ Missing              │ <Context> (token  │
  │ display        │                                   │                      │ usage + cost)     │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Plan           │ Missing                           │ Missing              │ <Plan>            │
  │ visualization  │                                   │                      │ (streaming)       │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Queue / task   │ Missing                           │ Missing              │ <Queue>           │
  │ list           │                                   │                      │                   │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Code block     │                                   │                      │ <CodeBlock>       │
  │ (rich)         │ Basic in Markdown                 │ Via markdown plugin  │ (Shiki + line     │
  │                │                                   │                      │ numbers)          │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Terminal       │ Missing                           │ Missing              │ <Terminal> (ANSI  │
  │ output         │                                   │                      │ 256-color)        │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ File tree      │ Missing                           │ Missing              │ <FileTree>        │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Diff viewer    │ Missing                           │ Via styled component │ Part of code      │
  │                │                                   │                      │ components        │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Workflow       │ Missing                           │ Missing              │ <Canvas> (React   │
  │ canvas         │                                   │                      │ Flow)             │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Agent card     │ <AgentCard/>                      │ Via model context    │ <Agent> (tools +  │
  │                │                                   │                      │ schema)           │
  ├────────────────┼───────────────────────────────────┼──────────────────────┼───────────────────┤
  │ Composition    │ Chat.Header/Messages/Input/Footer │ Full compound        │ Full compound     │
  │ API            │                                   │ pattern              │ pattern           │
  └────────────────┴───────────────────────────────────┴──────────────────────┴───────────────────┘

  ---
  Gap Summary for RAG Applications

  Evidence notes (codebase snapshot: 2026-03-03)

  - <InlineCitation/> already has hover tooltip behavior; gap is richer source cards (quotes/carousel)
  - ToolStatusBadge supports approval-related states, but default Chat has no approve/deny action flow
  - Stream handler receives step-start/step-end events but default client handling ignores them

  What Veryfront Already Has (strengths)

  1. Integrated pipeline: useChat → createChatHandler → agent → documentStore — end-to-end in one
  framework
  2. Browser inference fallback — unique differentiator, no other library has this
  3. beforeStream hook — clean RAG context injection without custom routes
  4. Source extraction — extractSourcesFromParts() + <Sources/> component
  5. Document upload API — createDocumentHandler() for CRUD
  6. Inference badge / upgrade CTA — edge/local inference awareness
  7. Streaming protocol — custom text/reasoning/tool/data events (step events exist but are not rendered in default UI)

  Critical Gaps for RAG-quality UI

  ┌──────────┬────────────────────┬───────────────────────────────┬────────────────────────────────┐
  │ Priority │        Gap         │            Impact             │           Reference            │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P1       │ Rich inline        │ Tooltip exists, but no        │ AI Elements <InlineCitation>   │
  │          │ citation cards     │ quote/carousel citation card  │                                │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P0       │ Drag-and-drop file │ Poor document upload UX for   │ Both libraries have drop zones │
  │          │  upload            │ RAG                           │                                │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P0       │ Message editing +  │ Can't refine RAG queries      │ assistant-ui                   │
  │          │ branching          │ without restarting            │ BranchPickerPrimitive          │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P1       │ Tool approval      │ No user-facing approve/deny   │ AI Elements <Confirmation>     │
  │          │ (HITL)             │ action flow in default Chat   │                                │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P1       │ Rich attachment    │ No thumbnails, no in-message  │ Both libraries                 │
  │          │ preview            │ attachments                   │                                │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P1       │ Conversation       │ Users can't save RAG research │ Both have markdown export      │
  │          │ export             │  sessions                     │                                │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P1       │ Feedback (thumbs   │ No signal for RAG quality     │ assistant-ui                   │
  │          │ up/down)           │ improvement                   │ FeedbackPositive/Negative      │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P2       │ Thread list /      │ No conversation persistence   │ assistant-ui                   │
  │          │ history            │ UI                            │ ThreadListPrimitive            │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P2       │ Token/context      │ Users don't know context      │ AI Elements <Context>          │
  │          │ display            │ window usage                  │                                │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P2       │ Rich code blocks   │ No line numbers, no Shiki     │ AI Elements <CodeBlock>        │
  │          │                    │ highlighting                  │                                │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P2       │ Chain of thought   │ No multi-step reasoning       │ AI Elements <ChainOfThought>   │
  │          │ steps              │ visualization                 │                                │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P3       │ Plan visualization │ Can't show agent execution    │ AI Elements <Plan>             │
  │          │                    │ plans                         │                                │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P3       │ Terminal / sandbox │ Can't show code execution     │ AI Elements unique             │
  │          │                    │ output                        │                                │
  ├──────────┼────────────────────┼───────────────────────────────┼────────────────────────────────┤
  │ P3       │ Workflow canvas    │ No visual agent orchestration │ AI Elements unique             │
  └──────────┴────────────────────┴───────────────────────────────┴────────────────────────────────┘

  Architectural Gap: Composition Pattern

  The biggest structural difference: both assistant-ui and AI Elements use a fully composable compound
  component pattern where every piece is independently nestable. Veryfront's <Chat/> is closer to a
  monolithic component with renderMessage/renderTool escape hatches.

  Current Veryfront pattern:
  <Chat
    messages={messages}
    input={input}
    onSubmit={handleSubmit}
    renderTool={(tool) => <CustomTool tool={tool} />}
    showSources
  />

  What both libraries do instead:
  <Thread>
    <Thread.Viewport>
      <Thread.Messages>
        {(msg) => (
          <Message>
            <Message.Parts>
              {(part) => /* full control per part */}
            </Message.Parts>
            <Message.Actions>
              <Action.Copy />
              <Action.Edit />
              <Action.Regenerate />
            </Message.Actions>
          </Message>
        )}
      </Thread.Messages>
    </Thread.Viewport>
    <Composer>
      <Composer.Attachments />
      <Composer.Input />
      <Composer.Send />
    </Composer>
  </Thread>

  Veryfront already has the primitives layer (ChatContainer, MessageList, MessageItem, InputBox,
  SubmitButton) and the composition API (Chat.Header, Chat.Messages, Chat.Input, Chat.Footer), but the
  middle layer — per-message and per-part composition — is where the gap lives.

  ---
  Recommendation for RAG Template

  For the RAG template specifically, the highest-impact gaps to close are:

  1. Rich inline citation cards (quotes + preview context) — current tooltip is minimal for verification
  2. Drag-and-drop file upload — document ingestion is core to RAG
  3. Conversation export — RAG research sessions need to be saveable
  4. Source-aware input (reference sources in follow-up queries) — for multi-turn RAG
  5. Message editing — refining RAG queries is the #1 UX pattern

  The existing beforeStream hook + documentStore + <Sources/> combination is already stronger than what
   either library offers for backend RAG integration. Most gaps are on the frontend interaction layer, but
   thread history, export, and HITL approval typically also require backend/API contracts.
