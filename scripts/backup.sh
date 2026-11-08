#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)
tar -czf "backups/scribe-data-$stamp.tar.gz" data
ls -1t backups/scribe-data-*.tar.gz | tail -n +31 | xargs -r rm -f
echo "backup written: backups/scribe-data-$stamp.tar.gz"
