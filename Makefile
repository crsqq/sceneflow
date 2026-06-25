.PHONY: lint

lint:
	uv run --directory app pylint src/app/
