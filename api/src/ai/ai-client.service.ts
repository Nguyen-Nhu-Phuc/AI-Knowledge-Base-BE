import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type AiChunk = {
  chunk_index: number;
  content: string;
  token_count: number;
  metadata: Record<string, unknown>;
};

export type ParseChunkResult = {
  parser: string;
  page_count: number | null;
  char_count: number;
  chunk_count: number;
  chunks: AiChunk[];
};

export type EmbedResult = {
  embeddings: number[][];
  provider: string;
  model: string;
  tokens_in: number;
  dimensions: number;
};

export type GenerateResult = {
  answer: string;
  rewritten_query: string | null;
  citations: Array<{
    index: number;
    chunk_id?: string;
    document_id?: string;
    document_version_id?: string;
    snippet: string;
    score?: number;
    metadata?: Record<string, unknown>;
  }>;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
};

export type ResearchResult = {
  answer: string;
  steps: Array<{ step: number; action: string; detail: string }>;
  citations: GenerateResult['citations'];
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
};

@Injectable()
export class AiClientService {
  constructor(private readonly config: ConfigService) {}

  private baseUrl() {
    return this.config.getOrThrow<string>('AI_SERVICE_URL').replace(/\/$/, '');
  }

  private secret() {
    return this.config.getOrThrow<string>('AI_SERVICE_SECRET');
  }

  private async postJson<T>(
    path: string,
    body: unknown,
    timeoutMs = 90_000,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Service-Secret': this.secret(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`AI ${path} timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const err = (await response.json()) as { detail?: string };
        if (err.detail) detail = err.detail;
      } catch {
        // ignore
      }
      throw new Error(`AI ${path} failed (${response.status}): ${detail}`);
    }
    return (await response.json()) as T;
  }

  async parseAndChunk(params: {
    fileBuffer: Buffer;
    filename: string;
    mimeType: string;
  }): Promise<ParseChunkResult> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(params.fileBuffer)], {
      type: params.mimeType,
    });
    form.append('file', blob, params.filename);
    form.append('mime_type', params.mimeType);
    form.append('filename', params.filename);

    const response = await fetch(`${this.baseUrl()}/v1/ingest/parse-chunk`, {
      method: 'POST',
      headers: { 'X-AI-Service-Secret': this.secret() },
      body: form,
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = (await response.json()) as { detail?: string };
        if (body.detail) detail = body.detail;
      } catch {
        // ignore
      }
      throw new Error(`AI parse-chunk failed (${response.status}): ${detail}`);
    }

    return (await response.json()) as ParseChunkResult;
  }

  private defaultEmbeddingProvider() {
    return this.config.get<string>('AI_EMBEDDING_PROVIDER') || undefined;
  }

  private defaultLlmProvider() {
    return this.config.get<string>('AI_LLM_PROVIDER') || undefined;
  }

  embedTexts(texts: string[], provider?: string) {
    return this.postJson<EmbedResult>('/v1/embed', {
      texts,
      provider: provider || this.defaultEmbeddingProvider(),
    });
  }

  generate(body: {
    query: string;
    chunks: Array<Record<string, unknown>>;
    history?: Array<{ role: string; content: string }>;
    rewrite?: boolean;
    max_context_tokens?: number;
    provider?: string;
    system_prompt?: string;
  }) {
    return this.postJson<GenerateResult>('/v1/generate', {
      ...body,
      provider: body.provider || this.defaultLlmProvider(),
    });
  }

  research(body: {
    query: string;
    chunks: Array<Record<string, unknown>>;
    max_steps?: number;
    max_context_tokens?: number;
    provider?: string;
  }) {
    return this.postJson<ResearchResult>('/v1/agent/research', {
      ...body,
      provider: body.provider || this.defaultLlmProvider(),
    });
  }

  rerank(body: {
    query: string;
    documents: Array<Record<string, unknown>>;
    top_n?: number;
  }) {
    return this.postJson<{
      results: Array<Record<string, unknown>>;
      provider: string;
    }>('/v1/rerank', body);
  }

  planQueries(body: {
    query: string;
    max_queries?: number;
    provider?: string;
  }) {
    return this.postJson<{
      queries: string[];
      provider: string;
      model: string;
    }>('/v1/agent/plan-queries', {
      ...body,
      provider: body.provider || this.defaultLlmProvider(),
    });
  }

  async health() {
    const response = await fetch(`${this.baseUrl()}/health`, {
      headers: { 'X-AI-Service-Secret': this.secret() },
    });
    if (!response.ok) {
      throw new Error(`AI health failed (${response.status})`);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
