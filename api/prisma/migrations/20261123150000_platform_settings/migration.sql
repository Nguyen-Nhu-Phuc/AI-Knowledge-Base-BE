-- Super Admin platform settings (singleton)
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "default_embedding_provider" TEXT NOT NULL DEFAULT 'gemini',
    "default_llm_provider" TEXT NOT NULL DEFAULT 'gemini',
    "cost_per_1k_input_usd" DECIMAL(12,6) NOT NULL DEFAULT 0.00015,
    "cost_per_1k_output_usd" DECIMAL(12,6) NOT NULL DEFAULT 0.0006,
    "notes" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "platform_settings" ("id") VALUES ('default')
ON CONFLICT ("id") DO NOTHING;
