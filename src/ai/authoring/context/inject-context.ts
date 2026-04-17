import type { AuthoringMessage } from "@/ai/authoring/types";

const CONTEXT_BLOCK_REGEX =
  /<!-- authoring-context:fp=[a-f0-9]+ -->[\s\S]*?(?=(?:\n## User Request\n)|$)/;

function extractUserText(message: AuthoringMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

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

export function replaceAuthoringContext(input: {
  messages: AuthoringMessage[];
  contextBlock: string;
}): AuthoringMessage[] {
  return input.messages.map((message) => {
    if (message.role !== "user") {
      return message;
    }

    const textParts = message.parts.filter((part) => part.type === "text");
    if (textParts.length === 0) {
      return message;
    }

    const mergedText = textParts.map((part) => part.text).join("\n");
    const nextText = CONTEXT_BLOCK_REGEX.test(mergedText)
      ? mergedText.replace(CONTEXT_BLOCK_REGEX, input.contextBlock)
      : `${input.contextBlock}\n\n${mergedText}`.trim();

    return {
      ...message,
      parts: [
        { type: "text", text: nextText },
        ...message.parts.filter((part) => part.type !== "text"),
      ],
    };
  });
}
