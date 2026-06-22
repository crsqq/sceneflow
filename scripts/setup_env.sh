#!/bin/bash

# Exit on error
set -e

echo "🚀 Starting SceneFlow Environment Setup..."

# 1. Python Setup (using uv)
if command -v uv >/dev/null 2>&1; then
    echo "📦 Setting up Python environment with uv..."
    cd app
    uv sync
    cd ..
else
    echo "❌ Error: 'uv' is not installed. Please install it first."
    exit 1
fi

# 2. Node.js Setup (using npm)
if command -v npm >/dev/null 2>&1; then
    echo "📦 Installing Node.js dependencies..."
    npm install
else
    echo "❌ Error: 'npm' is not installed. Please install it first."
    exit 1
fi

echo "✅ Setup complete!"
echo "To start the backend: cd app && uv run uvicorn app.main:app --reload --app-dir src"
echo "To start the frontend shell: npm start"
