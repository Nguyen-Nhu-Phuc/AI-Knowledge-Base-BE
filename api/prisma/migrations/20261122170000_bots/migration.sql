CREATE TYPE "BotStatus" AS ENUM ('active', 'archived');

CREATE TABLE IF NOT EXISTS "bots" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "knowledge_base_id" UUID NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "system_prompt" TEXT NOT NULL DEFAULT 'You are an enterprise knowledge assistant. Answer ONLY using the provided context and cite sources with [n].',
  "status" "BotStatus" NOT NULL DEFAULT 'active',
  "settings" JSONB NOT NULL DEFAULT '{}',
  "created_by" UUID NOT NULL REFERENCES "users"("id"),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS "bots_org_idx" ON "bots"("organization_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "bots_kb_idx" ON "bots"("knowledge_base_id");

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "bot_id" UUID REFERENCES "bots"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "conversations_bot_idx" ON "conversations"("bot_id");
