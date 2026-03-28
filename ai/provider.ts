import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";

const defaultModelId = "gpt-4.1-mini";

type ApiMode = "chat" | "responses";
type ProviderKind = "openai" | "deepseek";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const deepseek = createDeepSeek({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

function resolveProviderKind(modelId: string): ProviderKind {
  const baseUrl = process.env.OPENAI_BASE_URL?.toLowerCase() ?? "";

  if (modelId.toLowerCase().startsWith("deepseek") || baseUrl.includes("deepseek")) {
    return "deepseek";
  }

  return "openai";
}

function resolveApiMode(providerKind: ProviderKind): ApiMode {
  if (providerKind === "deepseek") {
    return "chat";
  }

  return (process.env.OPENAI_API_MODE ??
    (process.env.OPENAI_BASE_URL ? "chat" : "responses")) as ApiMode;
}

function buildProviderOptions(
  providerKind: ProviderKind,
  apiMode: ApiMode,
  modelId: string,
): SharedV3ProviderOptions {
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT;
  const reasoningSummary = process.env.OPENAI_REASONING_SUMMARY;
  const forceReasoning =
    process.env.OPENAI_FORCE_REASONING === "1" ||
    process.env.OPENAI_FORCE_REASONING === "true";

  if (providerKind === "deepseek") {
    return {
      deepseek:
        forceReasoning || modelId.toLowerCase().includes("reasoner")
          ? {
              thinking: {
                type: "enabled" as const,
              },
            }
          : {},
    };
  }

  if (apiMode === "chat") {
    return {
      openai: {
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(forceReasoning ? { forceReasoning: true } : {}),
        systemMessageMode: "system",
      },
    };
  }

  return {
    openai: {
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(reasoningSummary ? { reasoningSummary } : {}),
      ...(forceReasoning ? { forceReasoning: true } : {}),
      ...(process.env.OPENAI_BASE_URL ? { systemMessageMode: "system" } : {}),
    },
  };
}

function isReasoningModel(providerKind: ProviderKind, modelId: string): boolean {
  if (providerKind === "deepseek") {
    return modelId.toLowerCase().includes("reasoner");
  }

  return false;
}

function resolveLanguageModel(
  providerKind: ProviderKind,
  apiMode: ApiMode,
  modelId: string,
) {
  if (providerKind === "deepseek") {
    return deepseek.chat(modelId as never);
  }

  if (apiMode === "chat") {
    return openai.chat(modelId as never);
  }

  return openai(modelId as never);
}

export function resolveAiModelConfig() {
  const modelId = process.env.OPENAI_MODEL ?? defaultModelId;
  const providerKind = resolveProviderKind(modelId);
  const apiMode = resolveApiMode(providerKind);

  return {
    modelId,
    providerKind,
    apiMode,
    model: resolveLanguageModel(providerKind, apiMode, modelId),
    providerOptions: buildProviderOptions(providerKind, apiMode, modelId),
    supportsTemperature: !isReasoningModel(providerKind, modelId),
  };
}

