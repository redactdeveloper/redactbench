import type { ModelConfig } from "../contracts.js";
import { createAnthropicAdapter } from "./anthropic.js";
import { createFixtureAdapter } from "./fixture.js";
import { createGoogleAdapter } from "./google.js";
import { createOpenAIAdapter } from "./openai.js";
import type { ProviderAdapter, ProviderDependencies } from "./types.js";

interface ProviderFactoryOptions extends ProviderDependencies {
  fixtureBaseDirectory?: string;
}

export function createProviderAdapter(
  modelConfig: ModelConfig,
  options: ProviderFactoryOptions = {}
): ProviderAdapter {
  switch (modelConfig.provider) {
    case "fixture":
      return createFixtureAdapter(modelConfig, {
        ...options,
        baseDirectory: options.fixtureBaseDirectory ?? process.cwd()
      });
    case "openai":
      return createOpenAIAdapter(modelConfig, options);
    case "anthropic":
      return createAnthropicAdapter(modelConfig, options);
    case "google":
      return createGoogleAdapter(modelConfig, options);
  }
}

export type {
  GenerationRequest,
  ProviderAdapter,
  ProviderResult,
  ProviderTiming,
  ProviderUsage
} from "./types.js";
