from __future__ import annotations
import os
from dataclasses import dataclass
from functools import lru_cache
from dotenv import load_dotenv

load_dotenv()

@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "FIELDWORK")
    featherless_api_key: str = os.getenv("FEATHERLESS_API_KEY", "").strip()
    featherless_base_url: str = os.getenv("FEATHERLESS_BASE_URL", "https://api.featherless.ai/v1").rstrip("/")
    featherless_model_id: str = os.getenv("FEATHERLESS_MODEL_ID", "darkc0de/XORTRON-RICO-v3").strip()
    xortron_agent_model_id: str = os.getenv("XORTRON_AGENT_MODEL_ID", "darkc0de/XORTRON-AgentRICO").strip()
    exa_api_key: str = os.getenv("EXA_API_KEY", "").strip()
    searxng_url: str = os.getenv("SEARXNG_URL", "").strip().rstrip("/")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./fieldwork.db").strip()
    app_password: str = os.getenv("APP_PASSWORD", "")
    request_timeout_seconds: float = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "28"))

@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
