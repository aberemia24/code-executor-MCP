#!/bin/bash

# SessionStart hook script for automatic dependency installation
# This script runs automatically when a Claude Code session starts
# Only runs in remote/web environments (not local)

# Only run in remote environments
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

set -e  # Exit on error

echo "🔧 Installing project dependencies..."

# Install npm dependencies
if [ -f "package.json" ]; then
  echo "📦 Installing npm packages..."
  npm install
else
  echo "⚠️  No package.json found, skipping npm install"
fi

# Install Python dependencies if requirements.txt exists
if [ -f "requirements.txt" ]; then
  echo "🐍 Installing Python packages..."
  pip install -r requirements.txt
else
  echo "ℹ️  No requirements.txt found, skipping pip install"
fi

echo "✅ Dependency installation complete!"

exit 0
