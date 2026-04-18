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

    # Square
    square_access_token: str = ""
    square_environment: str = "sandbox"

    # Anthropic (Claude)
    anthropic_api_key: str = ""

    # GoDaddy
    godaddy_api_key: str = ""
    godaddy_api_secret: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
