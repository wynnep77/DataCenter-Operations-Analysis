#!/usr/bin/env bash
# Displays the administrator token from .env for easy copy-paste
# Usage: ./scripts/show-admin-token.sh

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Error: .env file not found. Please run: cp .env.example .env"
  exit 1
fi

TOKEN=$(grep -E '^ADMIN_TOKEN=' .env | cut -d= -f2-)

if [ -z "$TOKEN" ] || [ "$TOKEN" = "CHANGE_THIS_TO_SECURE_RANDOM_TOKEN" ]; then
  echo "Error: ADMIN_TOKEN is not set or still has the default value."
  echo "Please set a secure token in .env, for example:"
  echo "  sed -i \"s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=\$(openssl rand -hex 24)/\" .env"
  exit 1
fi

echo "Your administrator token is:"
echo ""
echo "  $TOKEN"
echo ""
echo "Copy this token and paste it into the Administrator tab in the dashboard."
echo "The dashboard will remember it in your browser's local storage."
