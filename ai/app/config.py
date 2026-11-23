from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "ai-knowledge-base-ai"
    api_prefix: str = "/v1"
    service_secret: str = "dev-ai-service-secret"
    host: str = "0.0.0.0"
    port: int = 8000
    chunk_size_tokens: int = 700
    chunk_overlap_tokens: int = 90
    chunk_min_tokens: int = 80
    max_file_bytes: int = 52_428_800

    # Text → Vector
    embedding_provider: str = "mock"  # mock | openai | gemini
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    gemini_embedding_model: str = "gemini-embedding-001"

    # Text → Answer
    llm_provider: str = "mock"  # mock | openai | gemini
    llm_model: str = "gpt-4o-mini"
    # Prefer lighter model first — 3.8-flash often returns 503 under load
    gemini_llm_model: str = "gemini-2.5-flash"
    # Comma-separated fallbacks tried on 503 / timeout
    gemini_llm_fallbacks: str = (
        "gemini-2.5-flash-lite,gemini-flash-latest,gemini-3.8-flash"
    )
    gemini_llm_retries: int = 2

    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"

    gemini_api_key: str = ""
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"

    # Image → Text (OCR)
    ocr_enabled: bool = True
    # Vietnamese first for mixed Vi/En scans (medical/internal docs)
    ocr_lang: str = "vie+eng"
    ocr_dpi: int = 360
    # If native PDF text is shorter than this (and page has images), force OCR
    ocr_min_native_chars: int = 80

    max_context_tokens: int = 3000
    enable_query_rewrite: bool = True
    # Mask emails/phones/secrets before embed/generate when requested
    dlp_enabled: bool = True


settings = Settings()
