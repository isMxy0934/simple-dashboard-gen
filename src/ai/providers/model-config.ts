import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { DeepSeekLanguageModelOptions } from "@ai-sdk/deepseek";
import { createDeepSeekProvider } from "./deepseek";
import { createOpenAiProvider } from "./openai";

const defaultModelId = "gpt-4.1-mini";

type ApiMode = "chat" | "responses";
type ProviderKind = "openai" | "deepseek";

const openai = createOpenAiProvider();
const deepseek = createDeepSeekProvider();

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

function parseBooleanEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function resolveDeepSeekThinkingMode(modelId: string): "enabled" | "disabled" {
  const explicitThinking =
    process.env.DEEPSEEK_THINKING ?? process.env.OPENAI_DEEPSEEK_THINKING;
  if (explicitThinking === "enabled" || explicitThinking === "disabled") {
    return explicitThinking;
  }

  if (parseBooleanEnv(process.env.OPENAI_FORCE_REASONING)) {
    return "enabled";
  }

  if (modelId.toLowerCase().includes("reasoner")) {
    return "enabled";
  }

  if (modelId.toLowerCase().includes("v4")) {
    return "enabled";
  }

  return "disabled";
}

function buildProviderOptions(
  providerKind: ProviderKind,
  apiMode: ApiMode,
  modelId: string,
): SharedV3ProviderOptions {
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT;
  const reasoningSummary = process.env.OPENAI_REASONING_SUMMARY;
  const forceReasoning = parseBooleanEnv(process.env.OPENAI_FORCE_REASONING);

  if (providerKind === "deepseek") {
    return {
      deepseek: {
        thinking: {
          type: resolveDeepSeekThinkingMode(modelId),
        },
      } satisfies DeepSeekLanguageModelOptions,
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
  const lowered = modelId.toLowerCase();
  if (providerKind === "deepseek") {
    return resolveDeepSeekThinkingMode(modelId) === "enabled";
  }

  return (
    lowered.startsWith("gpt-5") ||
    lowered.startsWith("o1") ||
    lowered.startsWith("o3") ||
    lowered.startsWith("o4")
  );
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

export function resolveProviderModelConfig() {
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
