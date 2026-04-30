import {
  getModel,
  supportsXhigh,
  type Model,
} from "@mariozechner/pi-ai";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

const defaultModelId = "gpt-4.1-mini";

type ProviderKind = "openai" | "deepseek";

function parseBooleanEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function resolveProviderKind(modelId: string): ProviderKind {
  const baseUrl = process.env.OPENAI_BASE_URL?.toLowerCase() ?? "";

  if (modelId.toLowerCase().startsWith("deepseek") || baseUrl.includes("deepseek")) {
    return "deepseek";
  }

  return "openai";
}

function normalizeModelId(providerKind: ProviderKind, modelId: string): string {
  if (providerKind === "deepseek") {
    if (modelId === "deepseek-v4-flash" || modelId === "deepseek-v4-pro") {
      return modelId;
    }
    if (modelId.toLowerCase().includes("pro")) {
      return "deepseek-v4-pro";
    }
    return "deepseek-v4-flash";
  }

  return modelId;
}

function isReasoningModel(providerKind: ProviderKind, modelId: string): boolean {
  const lowered = modelId.toLowerCase();
  if (providerKind === "deepseek") {
    const explicitThinking =
      process.env.DEEPSEEK_THINKING ?? process.env.OPENAI_DEEPSEEK_THINKING;
    if (explicitThinking === "disabled") {
      return false;
    }
    if (explicitThinking === "enabled") {
      return true;
    }
    return (
      parseBooleanEnv(process.env.OPENAI_FORCE_REASONING) ||
      lowered.includes("reasoner") ||
      lowered.includes("v4")
    );
  }

  return (
    parseBooleanEnv(process.env.OPENAI_FORCE_REASONING) ||
    lowered.startsWith("gpt-5") ||
    lowered.startsWith("o1") ||
    lowered.startsWith("o3") ||
    lowered.startsWith("o4")
  );
}

function resolveThinkingLevel(
  providerKind: ProviderKind,
  model: Model<any>,
  modelId: string,
): ThinkingLevel {
  if (!isReasoningModel(providerKind, modelId)) {
    return "off";
  }

  const configured =
    process.env.OPENAI_REASONING_EFFORT ??
    process.env.DEEPSEEK_THINKING ??
    process.env.OPENAI_DEEPSEEK_THINKING;

  if (
    configured === "minimal" ||
    configured === "low" ||
    configured === "medium" ||
    configured === "high" ||
    configured === "xhigh"
  ) {
    return configured === "xhigh" && !supportsXhigh(model) ? "high" : configured;
  }

  return "medium";
}

function resolveLanguageModel(providerKind: ProviderKind, modelId: string): Model<any> {
  if (providerKind === "deepseek") {
    return getModel("deepseek", modelId as never);
  }

  return getModel("openai", modelId as never);
}

export function resolveProviderModelConfig() {
  const requestedModelId = process.env.OPENAI_MODEL ?? defaultModelId;
  const providerKind = resolveProviderKind(requestedModelId);
  const modelId = normalizeModelId(providerKind, requestedModelId);
  const model = resolveLanguageModel(providerKind, modelId);
  const thinkingLevel = resolveThinkingLevel(providerKind, model, modelId);

  return {
    modelId,
    providerKind,
    model,
    thinkingLevel,
    supportsTemperature: thinkingLevel === "off",
    getApiKey: (provider: string) => {
      if (provider === "deepseek") {
        return process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY;
      }
      return process.env.OPENAI_API_KEY;
    },
  };
}
