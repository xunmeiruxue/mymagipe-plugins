#!/usr/bin/env bash
# Pack every workspace into dist/ with npm pack, to look at before publishing.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
for dir in plugins/* mcp/*; do
  [ -f "$dir/package.json" ] || continue
  private=$(node -p "require('./$dir/package.json').private || false")
  [ "$private" = "true" ] && { echo "skip $dir: private"; continue; }
  name=$(node -p "require('./$dir/package.json').name")
  (cd "$dir" && npm pack --pack-destination "$OLDPWD/dist" >/dev/null && echo "packed $name")
done
ls -lh dist
