import type { AuthoringIntent } from "@/ai/authoring/contracts/tool-io";
import { inferAuthoringIntentFromText } from "@/ai/authoring/runtime/intent";

export function inferAuthoringIntent(text: string): AuthoringIntent {
  return inferAuthoringIntentFromText(text);
}
