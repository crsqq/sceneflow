.PHONY: build-deps lint ruff-check ruff-fix run test pkill

build-deps:
	cd app && uv sync
	npm install

lint:
	cd app && uv run pylint src/app/

ruff-check:
	cd app && uv run ruff check src/app/

ruff-fix:
	cd app && uv run ruff check --fix src/app/ && cd app && uv run ruff format src/app/

run:
	pkill -f "uvicorn app.main:app --port 8000" || true; \
	ELECTRON_ENABLE_LOGGING=1 npm start

test:
	cd app && uv run --group dev pytest

pkill:
	pkill -f "uvicorn app.main:app --port 8000"
