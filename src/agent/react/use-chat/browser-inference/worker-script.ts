/**
 * Inline Worker script as a string.
 *
 * Loaded via Blob URL — no separate build entry point needed.
 * Dynamically imports @huggingface/transformers from CDN inside the Worker.
 */

export const WORKER_SCRIPT = /* js */ `
let pipeline = null;
let generating = false;

async function loadPipeline(callbacks) {
  if (pipeline) return pipeline;

  callbacks.onStatus("loading-runtime");

  const { pipeline: createPipeline, env } =
    await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.2");

  env.useBrowserCache = true;
  env.allowLocalModels = false;

  callbacks.onStatus("downloading-model");

  pipeline = await createPipeline(
    "text-generation",
    "HuggingFaceTB/SmolLM2-135M-Instruct",
    {
      dtype: "q4",
      device: "wasm",
      progress_callback: (progress) => {
        if (progress.status === "progress" && progress.total) {
          callbacks.onProgress(Math.round((progress.loaded / progress.total) * 100), progress.file);
        }
      },
    },
  );

  callbacks.onStatus("ready");
  return pipeline;
}

self.onmessage = async (event) => {
  const request = event.data;
  if (request.type !== "generate") return;

  const { id, messages, options } = request;

  try {
    const pipe = await loadPipeline({
      onStatus: (status) => self.postMessage({ type: "status", status }),
      onProgress: (progress, file) => self.postMessage({ type: "download-progress", progress, file }),
    });

    self.postMessage({ type: "status", status: "generating" });
    generating = true;

    const chatMessages = [];
    if (options?.systemPrompt) {
      chatMessages.push({ role: "system", content: options.systemPrompt });
    }
    chatMessages.push(...messages);

    const result = await pipe(chatMessages, {
      max_new_tokens: options?.maxNewTokens ?? 512,
      temperature: options?.temperature ?? 0.7,
      do_sample: true,
      return_full_text: false,
      callback_function: (output) => {
        if (!generating) return;
        const text = output?.[0]?.generated_text;
        if (typeof text === "string") {
          self.postMessage({ type: "token", id, token: text });
        }
      },
    });

    generating = false;
    const finalText = result?.[0]?.generated_text ?? "";
    self.postMessage({ type: "done", id, text: finalText });
  } catch (error) {
    generating = false;
    self.postMessage({ type: "error", id, error: error?.message ?? String(error) });
  }
};
`;
