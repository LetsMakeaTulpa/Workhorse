from fastapi.testclient import TestClient
from backend.main import app


def test_health_endpoint_does_not_require_login():
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["ok"] is True
