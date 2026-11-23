-- FTS GIN for faster keyword retrieval
CREATE INDEX IF NOT EXISTS document_chunks_content_fts_idx
  ON document_chunks
  USING GIN (to_tsvector('simple', content));

-- ACL
CREATE TYPE "AclPrincipalType" AS ENUM ('user', 'role');
CREATE TYPE "AclPermission" AS ENUM ('read', 'write', 'admin');

CREATE TABLE IF NOT EXISTS "knowledge_base_acls" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "knowledge_base_id" UUID NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
  "principal_type" "AclPrincipalType" NOT NULL,
  "principal_id" TEXT NOT NULL,
  "permission" "AclPermission" NOT NULL DEFAULT 'read',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "knowledge_base_acls_unique" UNIQUE ("knowledge_base_id", "principal_type", "principal_id")
);

CREATE INDEX IF NOT EXISTS "knowledge_base_acls_kb_idx" ON "knowledge_base_acls"("knowledge_base_id");

CREATE TABLE IF NOT EXISTS "document_acls" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "principal_type" "AclPrincipalType" NOT NULL,
  "principal_id" TEXT NOT NULL,
  "permission" "AclPermission" NOT NULL DEFAULT 'read',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "document_acls_unique" UNIQUE ("document_id", "principal_type", "principal_id")
);

CREATE INDEX IF NOT EXISTS "document_acls_doc_idx" ON "document_acls"("document_id");

-- Connectors
CREATE TYPE "ConnectorType" AS ENUM ('local_folder', 'google_drive');
CREATE TYPE "ConnectorStatus" AS ENUM ('active', 'paused', 'error');
CREATE TYPE "ConnectorSyncStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

CREATE TABLE IF NOT EXISTS "connectors" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "knowledge_base_id" UUID NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
  "type" "ConnectorType" NOT NULL,
  "name" TEXT NOT NULL,
  "status" "ConnectorStatus" NOT NULL DEFAULT 'active',
  "config" JSONB NOT NULL DEFAULT '{}',
  "cursor" JSONB NOT NULL DEFAULT '{}',
  "last_sync_at" TIMESTAMPTZ(6),
  "created_by" UUID NOT NULL REFERENCES "users"("id"),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "connectors_org_idx" ON "connectors"("organization_id");
CREATE INDEX IF NOT EXISTS "connectors_kb_idx" ON "connectors"("knowledge_base_id");

CREATE TABLE IF NOT EXISTS "connector_sync_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "connector_id" UUID NOT NULL REFERENCES "connectors"("id") ON DELETE CASCADE,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "status" "ConnectorSyncStatus" NOT NULL DEFAULT 'queued',
  "stats" JSONB NOT NULL DEFAULT '{}',
  "error" TEXT,
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "connector_sync_runs_connector_idx"
  ON "connector_sync_runs"("connector_id", "created_at");

-- External identity on documents for incremental sync
ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "external_id" TEXT,
  ADD COLUMN IF NOT EXISTS "external_source" TEXT,
  ADD COLUMN IF NOT EXISTS "content_checksum" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "documents_org_external_unique"
  ON "documents"("organization_id", "external_source", "external_id")
  WHERE "external_id" IS NOT NULL AND "deleted_at" IS NULL;
