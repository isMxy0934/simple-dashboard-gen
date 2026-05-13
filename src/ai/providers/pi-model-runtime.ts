import {
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import {
  streamSimple,
  type Api,
  type Model,
} from "@mariozechner/pi-ai";
import type {
  StreamFn,
  ThinkingLevel,
} from "@mariozechner/pi-agent-core";

const validThinkingLevels = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export interface PiModelRuntimeServices {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
}

export interface PiModelRuntime {
  provider: string;
  modelId: string;
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
  modelRegistry: ModelRegistry;
  authStorage: AuthStorage;
  streamFn: StreamFn;
}

interface ResolvePiModelRuntimeOptions {
  services?: PiModelRuntimeServices;
  env?: NodeJS.ProcessEnv;
}

let defaultServices: PiModelRuntimeServices | null = null;

function getDefaultServices(): PiModelRuntimeServices {
  if (!defaultServices) {
    const authStorage = AuthStorage.inMemory();
    defaultServices = {
      authStorage,
      modelRegistry: ModelRegistry.inMemory(authStorage),
    };
  }
  return defaultServices;
}

function readNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
  const trimmed = readNonEmpty(value);
  if (!trimmed) {
    return undefined;
  }
  return validThinkingLevels.has(trimmed as ThinkingLevel)
    ? (trimmed as ThinkingLevel)
    : undefined;
}

function findUniqueModelById(
  modelRegistry: ModelRegistry,
  modelId: string,
): Model<Api> | undefined {
  const matches = modelRegistry.getAll().filter((model) => model.id === modelId);
  return matches.length === 1 ? matches[0] : undefined;
}

function firstModelForProvider(
  modelRegistry: ModelRegistry,
  provider: string,
): Model<Api> | undefined {
  const available = modelRegistry
    .getAvailable()
    .find((model) => model.provider === provider);
  if (available) {
    return available;
  }
  return modelRegistry.getAll().find((model) => model.provider === provider);
}

function resolveRequestedModel(input: {
  provider?: string;
  modelId?: string;
  modelRegistry: ModelRegistry;
}): Model<Api> | undefined {
  if (input.provider && input.modelId) {
    return input.modelRegistry.find(input.provider, input.modelId);
  }
  if (input.provider) {
    return firstModelForProvider(input.modelRegistry, input.provider);
  }
  if (input.modelId) {
    return findUniqueModelById(input.modelRegistry, input.modelId);
  }
  return input.modelRegistry.getAvailable()[0];
}

function createModelRegistryStreamFn(modelRegistry: ModelRegistry): StreamFn {
  return async (model, context, options) => {
    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      throw new Error(auth.error);
    }
    return streamSimple(model, context, {
      ...options,
      apiKey: auth.apiKey,
      headers:
        auth.headers || options?.headers
          ? { ...auth.headers, ...options?.headers }
          : undefined,
    });
  };
}

export async function resolvePiModelRuntime(
  options: ResolvePiModelRuntimeOptions = {},
): Promise<PiModelRuntime> {
  const services = options.services ?? getDefaultServices();
  const env = options.env ?? process.env;
  const provider =
    readNonEmpty(env.PI_PROVIDER);
  const modelId =
    readNonEmpty(env.PI_MODEL);

  if (!provider || !modelId) {
    throw new Error("PI_PROVIDER and PI_MODEL are required.");
  }

  const model = resolveRequestedModel({
    provider,
    modelId,
    modelRegistry: services.modelRegistry,
  });
  if (!model) {
    throw new Error(
      `Pi model is not available: ${provider} / ${modelId}`,
    );
  }

  const auth = await services.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(auth.error);
  }
  if (
    !auth.apiKey &&
    !auth.headers &&
    !services.modelRegistry.hasConfiguredAuth(model)
  ) {
    throw new Error(`No auth configured for Pi provider "${model.provider}".`);
  }

  const configuredThinkingLevel =
    parseThinkingLevel(env.PI_THINKING_LEVEL) ?? "medium";
  const thinkingLevel = model.reasoning ? configuredThinkingLevel : "off";

  return {
    provider: model.provider,
    modelId: model.id,
    model,
    thinkingLevel,
    modelRegistry: services.modelRegistry,
    authStorage: services.authStorage,
    streamFn: createModelRegistryStreamFn(services.modelRegistry),
  };
}

export function resetPiModelRuntimeServicesForTest(): void {
  defaultServices = null;
}
