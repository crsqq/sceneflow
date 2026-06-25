.PHONY: lint run

lint:
	uv run --directory app pylint src/app/

run:
	pkill -f "uvicorn app.main:app --port 8000" || true; \
	ELECTRON_ENABLE_LOGGING=1 npm start
