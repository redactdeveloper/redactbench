import type { ProviderName } from "../contracts.js";

export interface GenerationRequest {
  fixtureResponseKey?: string;
  maxOutputTokens: number;
  prompt: string;
  requestId?: string;
  system: string;
  temperature?: number;
  workspaceDirectory?: string;
}

export interface ProviderUsage {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderTiming {
  completedAt: string;
  durationMs: number;
  generationMs: number;
  outputTokensPerSecond: number | null;
  startedAt: string;
  ttftMs: number | null;
}

export interface ProviderResult {
  model: string;
  provider: ProviderName;
  providerRequestId: string | null;
  text: string;
  timing: ProviderTiming;
  usage: ProviderUsage | null;
}

export interface ProviderAdapter {
  readonly model: string;
  readonly provider: ProviderName;
  readonly workspaceMode?: boolean;
  generate(request: GenerationRequest): Promise<ProviderResult>;
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface ProviderDependencies {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: FetchLike;
  maxResponseBytes?: number;
  now?: () => number;
  timeoutMs?: number;
}
