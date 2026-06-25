def test_all_modules_import():
    import app.core.database  # noqa: F401
    import app.core.exporter  # noqa: F401
    import app.core.media_engine  # noqa: F401
    import app.core.query_parser  # noqa: F401
    import app.core.telemetry  # noqa: F401
    import app.main  # noqa: F401


def test_root_endpoint():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {"message": "SceneFlow API is running"}
