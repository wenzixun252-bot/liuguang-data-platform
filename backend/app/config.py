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
    feishu_base_domain: str = ""  # 如 "vzyjg03bu3.feishu.cn"，用于构建多维表格链接

    # ── ETL 注册中心 ──
    etl_registry_app_token: str = ""
    etl_registry_table_id: str = ""
    etl_cron_minutes: int = 30

    # ── 系统超管（不可被降级）──
    super_admin_open_id: str = "ou_6fc8627b98c383bfa8a61d8c9cd440c5"

    # ── JWT ──
    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24h

    # ── LLM (Schema 映射 / 关键信息提取) ──
    llm_api_key: str = ""
    llm_base_url: str = "https://newapi.web.azyinghu.com:2443/v1"
    llm_model: str = "glm-4.5-air"

    # ── Embedding ──
    embedding_api_key: str = ""
    embedding_base_url: str = "https://newapi.web.azyinghu.com:2443/v1"
    embedding_model: str = "BAAI/bge-m3"
    embedding_dimension: int = 1024

    # ── 视觉模型 (图片识别) ──
    vision_llm_model: str = "qwen3-vl-8b-instruct"

    # ── 流光助手 Agent LLM ──
    agent_llm_api_key: str = ""
    agent_llm_base_url: str = "https://newapi.web.azyinghu.com:2443/v1"
    agent_llm_model: str = "glm-5"

    # ── ASR 语音转文字 ──
    asr_api_key: str = ""
    asr_base_url: str = "https://newapi.web.azyinghu.com:2443/v1"
    asr_model: str = "funasr"

    # ── 文件上传 ──
    upload_dir: str = "uploads"
    max_upload_size_mb: int = 50
    allowed_file_types: str = "pdf,docx,txt,csv,xlsx,png,jpg,jpeg,mp3,wav,m4a,aac,ogg,flac"


settings = Settings()
