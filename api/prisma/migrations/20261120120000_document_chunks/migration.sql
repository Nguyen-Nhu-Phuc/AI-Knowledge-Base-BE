-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "knowledge_base_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1536),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_version_id_chunk_index_key" ON "document_chunks"("document_version_id", "chunk_index");

-- CreateIndex
CREATE INDEX "document_chunks_knowledge_base_id_document_version_id_idx" ON "document_chunks"("knowledge_base_id", "document_version_id");

-- CreateIndex
CREATE INDEX "document_chunks_organization_id_idx" ON "document_chunks"("organization_id");

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
