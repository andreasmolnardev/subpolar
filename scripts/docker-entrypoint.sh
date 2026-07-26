#!/bin/bash
set -e

export HOME=/home/node
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:/usr/local/bin:$PATH"

echo "🔍 Checking Bun installation..."

if ! command -v bun >/dev/null 2>&1; then
  echo "❌ Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  
  if ! command -v bun >/dev/null 2>&1; then
    echo "❌ Failed to install Bun. Exiting."
    exit 1
  fi
  
  echo "✅ Bun installed successfully"
else
  BUN_VERSION=$(bun --version 2>&1 || echo "unknown")
  echo "✅ Bun is installed (version: $BUN_VERSION)"
fi

echo "🚀 Starting Subpolar Backend..."

if [ -z "$AUTH_SECRET" ]; then
  if [ -f /app/config.json ]; then
    AUTH_SECRET=$(jq -r '.AUTH_SECRET // empty' /app/config.json 2>/dev/null)
    if [ -n "$AUTH_SECRET" ]; then
      echo "✅ AUTH_SECRET loaded from config.json"
      export AUTH_SECRET
    fi
  fi
fi

if [ -z "$AUTH_SECRET" ]; then
  echo "❌ AUTH_SECRET is required but not set"
  echo ""
  echo "Set it in config.json or as an environment variable:"
  echo ""
  echo "  Option 1: Add to config.json:"
  echo '    "AUTH_SECRET": "your-secure-random-secret-here"'
  echo ""
  echo "  Option 2: Set in docker-compose.yml environment:"
  echo "    - AUTH_SECRET=\$(openssl rand -base64 32)"
  echo ""
  echo "  Option 3: Generate one and pass at runtime:"
  echo "    docker run -e AUTH_SECRET=\$(openssl rand -base64 32) ..."
  echo ""
  exit 1
fi

mkdir -p /app/data /workspace /home/node/.cache
chown -R node:node /app/data /workspace /home/node

if [ -S /var/run/docker.sock ]; then
  DOCKER_SOCKET_GID=$(stat -c '%g' /var/run/docker.sock)
  DOCKER_SOCKET_GROUP=$(getent group "$DOCKER_SOCKET_GID" | cut -d: -f1)
  if [ -z "$DOCKER_SOCKET_GROUP" ]; then
    DOCKER_SOCKET_GROUP=docker-host
    groupadd --gid "$DOCKER_SOCKET_GID" "$DOCKER_SOCKET_GROUP"
  fi
  exec runuser -u node -G "$DOCKER_SOCKET_GROUP" -- "$@"
fi

exec runuser -u node -- "$@"
