from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    app_name: str = "Six Beans Coffee Co."
    debug: bool = False

    # Database
    database_url: str = "sqlite+aiosqlite:///./sixbeans.db"

    # JWT
    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 43200
    refresh_token_expire_days: int = 90

    # Timezone
    timezone: str = "America/Los_Angeles"

    # CORS (comma-separated string, parsed in main.py)
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # Twilio
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""

    # Square (POS + supply ordering)
    square_access_token: str = ""
    square_environment: str = "production"

    # Gmail SMTP for supply reports
    gmail_app_password: str = ""
    gmail_from: str = ""

    # Anthropic (Claude)
    anthropic_api_key: str = ""

    # GoDaddy (legacy — no public merchant API; ingestion via scraper below)
    godaddy_api_key: str = ""
    godaddy_api_secret: str = ""

    # ---- Analytics ingestion ----
    # TapMango loyalty/orders API
    tapmango_api_key: str = ""
    tapmango_api_base_url: str = "https://openapi.tapmango.com/api/v1"

    # Encryption key for scraper session cookies persisted in DB
    scraper_session_encryption_key: str = ""

    # Gmail OAuth (for DoorDash weekly email watcher)
    gmail_oauth_client_id: str = ""
    gmail_oauth_client_secret: str = ""
    gmail_oauth_redirect_uri: str = (
        "http://localhost:5173/portal/admin/oauth/callback/gmail"
    )

    # DoorDash report routing
    doordash_report_from_email: str = "no-reply@doordash.com"
    doordash_report_inbox: str = "blend556@gmail.com"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
