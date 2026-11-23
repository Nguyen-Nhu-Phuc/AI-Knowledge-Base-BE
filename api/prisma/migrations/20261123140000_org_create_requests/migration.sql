-- CreateEnum
CREATE TYPE "OrganizationCreateRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "organization_create_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "status" "OrganizationCreateRequestStatus" NOT NULL DEFAULT 'pending',
    "requested_by" UUID NOT NULL,
    "reviewed_by" UUID,
    "review_note" TEXT,
    "organization_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),

    CONSTRAINT "organization_create_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_create_requests_status_created_at_idx" ON "organization_create_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "organization_create_requests_requested_by_created_at_idx" ON "organization_create_requests"("requested_by", "created_at");

-- CreateIndex
CREATE INDEX "organization_create_requests_slug_status_idx" ON "organization_create_requests"("slug", "status");

-- AddForeignKey
ALTER TABLE "organization_create_requests" ADD CONSTRAINT "organization_create_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_create_requests" ADD CONSTRAINT "organization_create_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
