from __future__ import annotations

import hmac
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import desc
from sqlalchemy.orm import Session

from .config import get_settings
from .database import SessionLocal, get_db, init_db
from .models import Conversation, Message, utcnow
from .prompts import DEFAULT_SYSTEM_PROMPT
from .providers.featherless import FeatherlessProvider
from .providers.search import run_search
from .schemas import AuthCheck, ChatRequest, ConversationUpdate, SearchRequest
from .services.research import prepare_research_turn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fieldwork")

app = FastAPI(title="FIELDWORK Research", docs_url=None, redoc_url=None)
STATIC_DIR = Path(__file__).parent / "static"


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


def require_app_access(x_app_password: str | None = Header(default=None)) -> None:
    expected = get_settings().app_password
    if expected and not hmac.compare_digest(x_app_password or "", expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login required.")


def _serialize_message(item: Message) -> dict[str, Any]:
    try:
        sources = json.loads(item.sources_json) if item.sources_json else []
    except json.JSONDecodeError:
        sources = []
    try:
        provider_status = json.loads(item.provider_status_json) if item.provider_status_json else []
    except json.JSONDecodeError:
        provider_status = []
    return {
        "id": item.id, "role": item.role, "content": item.content, "model": item.model,
        "sources": sources, "provider_status": provider_status,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "prompt_tokens": item.prompt_tokens, "completion_tokens": item.completion_tokens,
    }


def _serialize_conversation(item: Conversation, include_messages: bool = False) -> dict[str, Any]:
    value = {
        "id": item.id, "title": item.title, "archived": item.archived,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }
    if include_messages:
        value["messages"] = [_serialize_message(message) for message in item.messages]
    return value


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health():
    settings = get_settings()
    return {"ok": True, "app": settings.app_name, "auth_required": bool(settings.app_password), "database": "connected"}


@app.post("/api/auth/check")
def auth_check(body: AuthCheck):
    expected = get_settings().app_password
    if expected and not hmac.compare_digest(body.password, expected):
        raise HTTPException(status_code=401, detail="Incorrect password.")
    return {"ok": True, "auth_required": bool(expected)}


@app.get("/api/config", dependencies=[Depends(require_app_access)])
def app_config():
    settings = get_settings()
    return {
        "app": settings.app_name,
        "featherless_configured": bool(settings.featherless_api_key),
        "exa_configured": bool(settings.exa_api_key),
        "searxng_configured": bool(settings.searxng_url),
        "preferred_model": settings.featherless_model_id,
        "agent_model": settings.xortron_agent_model_id,
        "system_prompt": DEFAULT_SYSTEM_PROMPT,
    }


@app.get("/api/models", dependencies=[Depends(require_app_access)])
async def models(query: str = Query(default="", max_length=120)):
    settings = get_settings()
    if not settings.featherless_api_key:
        return {"configured": False, "preferred_model": settings.featherless_model_id,
                "agent_model": settings.xortron_agent_model_id, "models": [],
                "error": "FEATHERLESS_API_KEY is not configured."}
    try:
        all_models = await FeatherlessProvider().list_models()
        preferred, agent = settings.featherless_model_id, settings.xortron_agent_model_id
        q = query.casefold().strip()
        if q:
            candidates = [item for item in all_models if q in str(item.get("id", "")).casefold()
                          or q in str(item.get("name", "")).casefold()][:100]
        else:
            candidates = [item for item in all_models if item.get("id") in {preferred, agent}]
            if not candidates:
                candidates = [item for item in all_models if "xortron" in str(item.get("id", "")).casefold()][:30]
        ids = {str(item.get("id")) for item in all_models}
        return {"configured": True, "preferred_model": preferred, "agent_model": agent,
                "preferred_available": preferred in ids, "agent_available": agent in ids,
                "models": candidates, "total_models": len(all_models)}
    except Exception as exc:
        logger.exception("Featherless model discovery failed")
        return {"configured": True, "preferred_model": settings.featherless_model_id,
                "agent_model": settings.xortron_agent_model_id, "models": [], "error": str(exc)[:500]}


@app.get("/api/conversations", dependencies=[Depends(require_app_access)])
def list_conversations(archived: bool = False, db: Session = Depends(get_db)):
    items = db.query(Conversation).filter(Conversation.archived == archived).order_by(desc(Conversation.updated_at)).limit(100).all()
    return [_serialize_conversation(item) for item in items]


@app.get("/api/conversations/{conversation_id}", dependencies=[Depends(require_app_access)])
def get_conversation(conversation_id: str, db: Session = Depends(get_db)):
    item = db.get(Conversation, conversation_id)
    if not item:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return _serialize_conversation(item, include_messages=True)


@app.patch("/api/conversations/{conversation_id}", dependencies=[Depends(require_app_access)])
def update_conversation(conversation_id: str, body: ConversationUpdate, db: Session = Depends(get_db)):
    item = db.get(Conversation, conversation_id)
    if not item:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    if body.title is not None:
        item.title = body.title.strip()[:240]
    if body.archived is not None:
        item.archived = body.archived
    item.updated_at = utcnow()
    db.commit()
    return _serialize_conversation(item)


@app.delete("/api/conversations/{conversation_id}", dependencies=[Depends(require_app_access)])
def delete_conversation(conversation_id: str, db: Session = Depends(get_db)):
    item = db.get(Conversation, conversation_id)
    if not item:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    db.delete(item)
    db.commit()
    return {"ok": True}


@app.post("/api/search", dependencies=[Depends(require_app_access)])
async def manual_search(body: SearchRequest):
    return await run_search(body.query, providers=body.providers, depth=body.depth,
                            category=body.category, time_range=body.time_range)


@app.post("/api/chat/stream", dependencies=[Depends(require_app_access)])
async def chat_stream(body: ChatRequest):
    settings = get_settings()
    if not settings.featherless_api_key:
        raise HTTPException(status_code=503, detail="FEATHERLESS_API_KEY is not configured on the server.")
    model = (body.model or settings.featherless_model_id).strip()
    if not model:
        raise HTTPException(status_code=400, detail="Select a Featherless model.")

    async def generate():
        db = SessionLocal()
        try:
            conversation = db.get(Conversation, body.conversation_id) if body.conversation_id else None
            if body.conversation_id and not conversation:
                yield _sse("error", {"message": "Conversation not found. Start a new chat."})
                return
            is_new = conversation is None
            if is_new:
                title = body.message.strip().replace("\n", " ")[:64] or "New research"
                conversation = Conversation(title=title)
                db.add(conversation)
                db.commit()
                db.refresh(conversation)

            previous = db.query(Message).filter(Message.conversation_id == conversation.id).order_by(Message.created_at.asc()).all()
            history = [{"role": message.role, "content": message.content} for message in previous[-16:]]
            db.add(Message(conversation_id=conversation.id, role="user", content=body.message))
            conversation.updated_at = utcnow()
            db.commit()

            yield _sse("meta", {"conversation_id": conversation.id, "title": conversation.title, "new": is_new})
            prepared = await prepare_research_turn(
                question=body.message, history=history, providers=body.providers,
                search_enabled=body.search_enabled, depth=body.depth, category=body.category,
                time_range=body.time_range, system_prompt=body.system_prompt,
            )
            sources, provider_status = prepared["sources"], prepared["providers"]
            yield _sse("sources", {"items": sources, "providers": provider_status})

            answer_parts: list[str] = []
            async for token in FeatherlessProvider().stream_chat(
                model=model, messages=prepared["messages"], temperature=body.temperature, max_tokens=body.max_tokens
            ):
                answer_parts.append(token)
                yield _sse("delta", {"text": token})

            answer = "".join(answer_parts).strip()
            assistant_message = Message(
                conversation_id=conversation.id, role="assistant", content=answer, model=model,
                sources_json=json.dumps(sources, ensure_ascii=False),
                provider_status_json=json.dumps(provider_status, ensure_ascii=False),
            )
            db.add(assistant_message)
            conversation.updated_at = utcnow()
            db.commit()
            yield _sse("done", {"message_id": assistant_message.id, "model": model, "conversation_id": conversation.id})
        except Exception as exc:
            logger.exception("Chat stream failed")
            yield _sse("error", {"message": str(exc)[:1000]})
        finally:
            db.close()

    return StreamingResponse(generate(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
