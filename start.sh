#!/bin/bash

set -e

echo "🚀 Starting Docker containers..."
docker compose up -d --build

echo "⏳ Waiting for API to come online..."
sleep 8

# Check if the API is up
until $(curl --output /dev/null --silent --head --fail http://localhost:3000/health); do
    printf "The API is not up yet. Retrying in 2 seconds...\n"
    sleep 2
done

API_URL="http://localhost:3000/admin/bootstrap/company"
API_KEY="super-secret-key"

echo "🔐 Calling bootstrap API..."
curl -X POST "$API_URL" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json"

echo ""
echo "✅ Done"
