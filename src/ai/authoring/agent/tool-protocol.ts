import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";

export function findPseudoFunctionCall(messages: AuthoringMessage[]) {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant" || !Array.isArray(message.parts)) {
      continue;
    }
    for (const part of message.parts) {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        const match = part.text.match(/<function>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/function>/i);
        if (match?.[1]) {
          return match[1].trim();
        }
      }
    }
  }
  return null;
}

export function combineAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => s != null);
  if (present.length === 0) {
    return undefined;
  }
  if (present.length === 1) {
    return present[0];
  }
  const controller = new AbortController();
  const forward = () => {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  };
  for (const signal of present) {
    if (signal.aborted) {
      forward();
      break;
    }
    signal.addEventListener("abort", forward, { once: true });
  }
  return controller.signal;
}
