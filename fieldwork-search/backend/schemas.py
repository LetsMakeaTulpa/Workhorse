from __future__ import annotations
from pydantic import BaseModel, Field, field_validator

class AuthCheck(BaseModel):
    password: str = Field(default="", max_length=512)

class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(min_length=1, max_length=12000)
    search_enabled: bool = True
    providers: list[str] = Field(default_factory=lambda: ["exa", "searxng"])
    depth: str = "standard"
    category: str | None = None
    time_range: str | None = None
    model: str | None = Field(default=None, max_length=240)
    temperature: float = Field(default=0.35, ge=0, le=2)
    max_tokens: int = Field(default=1800, ge=32, le=8000)
    system_prompt: str | None = Field(default=None, max_length=12000)

    @field_validator("providers")
    @classmethod
    def only_supported_providers(cls, value: list[str]) -> list[str]:
        allowed = {"exa", "searxng"}
        return list(dict.fromkeys(p for p in value if p in allowed))

class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    providers: list[str] = Field(default_factory=lambda: ["exa", "searxng"])
    depth: str = "standard"
    category: str | None = None
    time_range: str | None = None

class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    archived: bool | None = None
