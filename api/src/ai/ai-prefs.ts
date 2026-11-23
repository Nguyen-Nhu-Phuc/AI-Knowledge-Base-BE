export type AiProviderName = 'mock' | 'openai' | 'gemini';

export function readOrgAiPrefs(settings: unknown): {
  embeddingProvider?: AiProviderName;
  llmProvider?: AiProviderName;
} {
  const s = (settings ?? {}) as Record<string, unknown>;
  const embedding =
    s.embedding_provider === 'mock' ||
    s.embedding_provider === 'openai' ||
    s.embedding_provider === 'gemini'
      ? s.embedding_provider
      : undefined;
  const llm =
    s.llm_provider === 'mock' ||
    s.llm_provider === 'openai' ||
    s.llm_provider === 'gemini'
      ? s.llm_provider
      : undefined;
  return { embeddingProvider: embedding, llmProvider: llm };
}
