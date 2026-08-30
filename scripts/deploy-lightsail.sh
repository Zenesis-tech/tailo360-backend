#!/usr/bin/env bash
set -Eeuo pipefail

readonly app_dir='/home/ubuntu/tailo360-backend'
readonly service_name='tailo360-api'
readonly readiness_url='http://127.0.0.1:4000/ready'

cd "$app_dir"

if [[ ! -f .env ]]; then
  echo "Deployment stopped: $app_dir/.env is missing." >&2
  exit 1
fi

git pull --ff-only origin main
npm ci --omit=dev
sudo -n systemctl restart "$service_name"

for attempt in {1..20}; do
  if curl --fail --silent --show-error "$readiness_url" >/dev/null; then
    echo 'Tailo360 API deployment is ready.'
    exit 0
  fi
  echo "Waiting for API readiness ($attempt/20)..."
  sleep 2
done

echo 'Deployment failed: API readiness check did not recover.' >&2
sudo -n systemctl status "$service_name" --no-pager >&2 || true
sudo -n journalctl -u "$service_name" -n 50 --no-pager >&2 || true
exit 1
