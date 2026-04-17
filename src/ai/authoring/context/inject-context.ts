import type { AuthoringMessage } from "@/ai/authoring/types";

const CONTEXT_BLOCK_REGEX =
  /<!-- authoring-context:fp=[a-f0-9]+ -->[\s\S]*?(?=(?:\n## User Request\n)|$)/;

function stripExistingContext(text: string): string {
  return text.replace(CONTEXT_BLOCK_REGEX, "").replace(/^## User Request\n/, "").trim();
}

function extractUserText(message: AuthoringMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => stripExistingContext(part.text))
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Inject the L2 context block into the latest user message.
 *
 * Idempotent: if the latest user message already carries a context block
 * (matched by fingerprint marker), the old block is stripped before the new
 * one is prepended. This prevents multi-turn accumulation of stale context.
 */
export function injectAuthoringContext(input: {
  messages: AuthoringMessage[];
  contextBlock: string;
}): AuthoringMessage[] {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message.role !== "user") {
      continue;
    }

    const userText = extractUserText(message);
    const mergedText = userText
      ? `## User Request\n${userText}`
      : "## User Request\n(continue)";
    const nextText = `${input.contextBlock}\n\n${mergedText}`.trim();

    const nextMessages = [...input.messages];
    nextMessages[index] = {
      ...message,
      parts: [
        { type: "text", text: nextText },
        ...message.parts.filter((part) => part.type !== "text"),
      ],
    };
    return nextMessages;
  }

  return [
    ...input.messages,
    {
      id: `authoring-context-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text: input.contextBlock }],
    } as AuthoringMessage,
  ];
}
