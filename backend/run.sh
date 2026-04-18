#!/bin/bash
set -e

echo "Starting Six Beans Coffee Co. Backend..."

# Run database migrations
echo "Running database migrations..."
alembic upgrade head 2>/dev/null || echo "No migrations to run (first time setup will use seed script)"

# Start the server
echo "Starting FastAPI server on port ${PORT:-8000}..."
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
