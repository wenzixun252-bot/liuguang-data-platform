from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── 数据库 ──
    database_url: str = "postgresql+asyncpg://postgres:password@localhost:5432/liuguang"

    # ── 飞书 ──
    feishu_app_id: str = ""
    feishu_app_secret: str = ""
    feishu_webhook_url: str = ""

    # ── ETL 注册中心 ──
    etl_registry_app_token: str = ""
    etl_registry_table_id: str = ""
    etl_cron_minutes: int = 30

    # ── JWT ──
    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24h

    # ── LLM (Schema 映射) ──
    llm_api_key: str = ""
    llm_base_url: str = "https://api.deepseek.com/v1"
    llm_model: str = "deepseek-chat"

    # ── Embedding ──
    embedding_api_key: str = ""
    embedding_base_url: str = "https://api.deepseek.com/v1"
    embedding_model: str = "text-embedding-v3"
    embedding_dimension: int = 1536

    # ── 流光助手 Agent LLM ──
    agent_llm_api_key: str = ""
    agent_llm_base_url: str = "https://api.deepseek.com/v1"
    agent_llm_model: str = "deepseek-chat"


settings = Settings()
