-- Enterprise AI KB parity: governance, connectors, graph, eval, MCP, OIDC

CREATE TYPE "DocumentTrustStatus" AS ENUM ('unverified', 'verified', 'rejected');
CREATE TYPE "DocumentKind" AS ENUM ('file', 'note');
CREATE TYPE "EntityType" AS ENUM ('person', 'team', 'project', 'topic');
CREATE TYPE "EvalRunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

ALTER TYPE "ConnectorType" ADD VALUE IF NOT EXISTS 'notion';
ALTER TYPE "ConnectorType" ADD VALUE IF NOT EXISTS 'confluence';
ALTER TYPE "ConnectorType" ADD VALUE IF NOT EXISTS 'slack_export';

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "kind" "DocumentKind" NOT NULL DEFAULT 'file',
  ADD COLUMN IF NOT EXISTS "trust_status" "DocumentTrustStatus" NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "verified_by" UUID,
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "owner_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "external_acl" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS "documents_knowledge_base_id_trust_status_idx"
  ON "documents"("knowledge_base_id", "trust_status");

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_verified_by_fkey"
  FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "oidc_identities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "email" CITEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oidc_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "oidc_identities_provider_subject_key"
  ON "oidc_identities"("provider", "subject");
CREATE INDEX IF NOT EXISTS "oidc_identities_user_id_idx" ON "oidc_identities"("user_id");

ALTER TABLE "oidc_identities"
  ADD CONSTRAINT "oidc_identities_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "entities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "type" "EntityType" NOT NULL,
  "name" TEXT NOT NULL,
  "external_key" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "entities_organization_id_type_name_key"
  ON "entities"("organization_id", "type", "name");
CREATE INDEX IF NOT EXISTS "entities_organization_id_type_idx"
  ON "entities"("organization_id", "type");

ALTER TABLE "entities"
  ADD CONSTRAINT "entities_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "entity_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "entity_id" UUID NOT NULL,
  "document_id" UUID,
  "user_id" UUID,
  "relation" TEXT NOT NULL DEFAULT 'related',
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entity_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "entity_links_organization_id_entity_id_idx"
  ON "entity_links"("organization_id", "entity_id");
CREATE INDEX IF NOT EXISTS "entity_links_document_id_idx" ON "entity_links"("document_id");

ALTER TABLE "entity_links"
  ADD CONSTRAINT "entity_links_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_links"
  ADD CONSTRAINT "entity_links_entity_id_fkey"
  FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_links"
  ADD CONSTRAINT "entity_links_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_links"
  ADD CONSTRAINT "entity_links_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "eval_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "knowledge_base_id" UUID,
  "status" "EvalRunStatus" NOT NULL DEFAULT 'queued',
  "score" DOUBLE PRECISION,
  "stats" JSONB NOT NULL DEFAULT '{}',
  "error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "eval_runs_organization_id_created_at_idx"
  ON "eval_runs"("organization_id", "created_at");

ALTER TABLE "eval_runs"
  ADD CONSTRAINT "eval_runs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "eval_runs"
  ADD CONSTRAINT "eval_runs_knowledge_base_id_fkey"
  FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "mcp_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY['search', 'get_document']::TEXT[],
  "revoked_at" TIMESTAMPTZ(6),
  "last_used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tokens_token_hash_key" ON "mcp_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "mcp_tokens_organization_id_idx" ON "mcp_tokens"("organization_id");

ALTER TABLE "mcp_tokens"
  ADD CONSTRAINT "mcp_tokens_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
