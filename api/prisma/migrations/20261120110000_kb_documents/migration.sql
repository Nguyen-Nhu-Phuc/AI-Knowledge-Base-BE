-- Extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "KnowledgeBaseStatus" AS ENUM ('active', 'archived');
CREATE TYPE "DocumentStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');
CREATE TYPE "ParseStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed');
CREATE TYPE "IngestionJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "KnowledgeBaseStatus" NOT NULL DEFAULT 'active',
    "embedding_model" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    "embedding_dimensions" INTEGER NOT NULL DEFAULT 1536,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "knowledge_base_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'pending',
    "current_version_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "page_count" INTEGER,
    "parse_status" "ParseStatus" NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "original_filename" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ingestion_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "status" "IngestionJobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "knowledge_bases_organization_id_deleted_at_idx" ON "knowledge_bases"("organization_id", "deleted_at");
CREATE INDEX "documents_knowledge_base_id_deleted_at_created_at_idx" ON "documents"("knowledge_base_id", "deleted_at", "created_at");
CREATE INDEX "documents_organization_id_status_idx" ON "documents"("organization_id", "status");
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");
CREATE INDEX "document_versions_organization_id_idx" ON "document_versions"("organization_id");
CREATE INDEX "ingestion_jobs_document_id_created_at_idx" ON "ingestion_jobs"("document_id", "created_at");
CREATE INDEX "ingestion_jobs_organization_id_status_idx" ON "ingestion_jobs"("organization_id", "status");

-- ForeignKeys
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
