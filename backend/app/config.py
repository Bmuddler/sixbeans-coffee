import os
import sys

from pydantic_settings import BaseSettings


# Sentinel used by the original code as a placeholder. Any deploy still using
# this string is refusing to boot — it indicates the operator forgot to set
# a real JWT_SECRET_KEY in the environment, which would allow trivial token
# forgery.
_JWT_INSECURE_DEFAULT = "change-me-in-production"


class Settings(BaseSettings):
    # App
    app_name: str = "Six Beans Coffee Co."
    debug: bool = False

    # Database
    database_url: str = "sqlite+aiosqlite:///./sixbeans.db"

    # JWT — MUST be set via JWT_SECRET_KEY env var. The default placeholder
    # is rejected at import time; never ship the app without a real secret.
    jwt_secret_key: str = _JWT_INSECURE_DEFAULT
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

    # Analytics health-check alerts (daily cron)
    analytics_alert_recipient: str = "logcastles@gmail.com"

    # Shared secret that physical kiosk devices must send in an
    # X-Kiosk-Secret header on every request to /api/kiosk/*. Leave empty
    # in environments where the kiosk flow is unused.
    kiosk_shared_secret: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()


# H1 guard: refuse to mint/verify tokens with the insecure placeholder
# JWT secret. Enforced lazily at the JWT use site (auth_service.py, the
# X-Cron-Key comparison) rather than at module import, so cron-only
# containers that never touch auth can still boot with the default. In
# any prod-ish deploy the web service has a real value and will trip
# the guard the first time it tries to sign a token — which is before
# the first login request completes, well before any auth happens.
def assert_jwt_secret_set() -> None:
    if settings.jwt_secret_key != _JWT_INSECURE_DEFAULT:
        return
    msg = (
        "FATAL: JWT_SECRET_KEY is unset or matches the insecure default "
        "('change-me-in-production'). Set a real value in your environment "
        "before starting the app — otherwise token forgery is trivial."
    )
    if settings.debug:
        print(f"WARNING: {msg}", file=sys.stderr)
    else:
        raise SystemExit(msg)
