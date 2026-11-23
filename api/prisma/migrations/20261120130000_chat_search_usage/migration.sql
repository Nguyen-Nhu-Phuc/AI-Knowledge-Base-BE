-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('active', 'archived');
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'system');
CREATE TYPE "FeedbackRating" AS ENUM ('positive', 'negative');

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "knowledge_base_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "status" "ConversationStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "token_in" INTEGER,
    "token_out" INTEGER,
    "model" TEXT,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "message_citations" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "chunk_id" UUID NOT NULL,
    "snippet" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "message_citations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rating" "FeedbackRating" NOT NULL,
    "reason" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_usage_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "cost_usd_estimate" DECIMAL(12,6),
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "request_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "conversations_organization_id_user_id_deleted_at_idx" ON "conversations"("organization_id", "user_id", "deleted_at");
CREATE INDEX "conversations_knowledge_base_id_idx" ON "conversations"("knowledge_base_id");
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");
CREATE INDEX "messages_organization_id_idx" ON "messages"("organization_id");
CREATE INDEX "message_citations_message_id_idx" ON "message_citations"("message_id");
CREATE UNIQUE INDEX "feedback_message_id_key" ON "feedback"("message_id");
CREATE INDEX "feedback_organization_id_created_at_idx" ON "feedback"("organization_id", "created_at");
CREATE INDEX "ai_usage_logs_organization_id_created_at_idx" ON "ai_usage_logs"("organization_id", "created_at");
CREATE INDEX "ai_usage_logs_organization_id_feature_created_at_idx" ON "ai_usage_logs"("organization_id", "feature", "created_at");

-- FKs
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "feedback" ADD CONSTRAINT "feedback_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Vector index (optional; safe if extension exists)
CREATE INDEX IF NOT EXISTS "document_chunks_embedding_hnsw_idx"
ON "document_chunks"
USING hnsw ("embedding" vector_cosine_ops);
