from fastapi.testclient import TestClient
from backend.main import app


def test_health_endpoint_does_not_require_login():
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["ok"] is True


def test_library_items_can_be_created_listed_and_deleted():
    import uuid

    item_id = str(uuid.uuid4())
    payload = {
        "id": item_id,
        "kind": "preset",
        "title": "Test configuration",
        "payload": {"model": "vendor/model", "providers": ["exa"], "dorks": []},
    }
    with TestClient(app) as client:
        created = client.post("/api/library", json=payload)
        assert created.status_code == 200
        assert created.json()["payload"]["model"] == "vendor/model"
        listed = client.get("/api/library")
        assert any(item["id"] == item_id for item in listed.json())
        deleted = client.delete("/api/library/" + item_id)
        assert deleted.status_code == 200
        assert not any(item["id"] == item_id for item in client.get("/api/library").json())
