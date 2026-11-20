#!/usr/bin/env bash
# Publish every workspace whose version npm doesn't have yet.
#
#   scripts/publish.sh                 publish / stage what is missing
#   scripts/publish.sh --dry-run       say what it would do, touch nothing
#   scripts/publish.sh <folder>...     only these
#
# Env:
#   NODE_AUTH_TOKEN   the npm token (from 1Password in CI; from ~/.npmrc locally)
#   STAGE_ON_NEW=1    a package npm doesn't have yet is staged
#                     (npm stage publish), for a maintainer to approve with 2FA
#   PROVENANCE=0      drop --provenance (a private repo can't make one)
set -euo pipefail
cd "$(dirname "$0")/.."

# the 1Password Environment injects NPM_TOKEN; npm wants NODE_AUTH_TOKEN
export NODE_AUTH_TOKEN="${NODE_AUTH_TOKEN:-${NPM_TOKEN:-}}"

dry=0
targets=()
for a in "$@"; do
  case "$a" in
    --dry-run) dry=1 ;;
    *) targets+=("$a") ;;
  esac
done
if [ ${#targets[@]} -eq 0 ]; then targets=(plugins/* mcp/*); fi

flag=""
[ "${PROVENANCE:-1}" = "0" ] || flag="--provenance"

have() { npm view "$1@$2" version >/dev/null 2>&1; }
known() { npm view "$1" version >/dev/null 2>&1; }

echo "npm: $(npm --version) · node: $(node --version) · auth: $([ -n "${NODE_AUTH_TOKEN:-}" ] && echo token || echo oidc)"

for dir in "${targets[@]}"; do
  [ -f "$dir/package.json" ] || continue
  name=$(node -p "require('./$dir/package.json').name")
  ver=$(node -p "require('./$dir/package.json').version")
  private=$(node -p "require('./$dir/package.json').private || false")
  [ "$private" = "true" ] && { echo "skip  $name: private"; continue; }

  if have "$name" "$ver"; then
    echo "skip  $name@$ver: npm already has it"
    continue
  fi

  if known "$name"; then
    echo "ship  $name@$ver"
    [ "$dry" = "1" ] && (cd "$dir" && npm publish --dry-run --access public --provenance) && continue
    (cd "$dir" && npm publish $flag --access public)
    continue
  fi

  # a package npm has never seen
  if [ "${STAGE_ON_NEW:-0}" = "1" ] && [ "$dry" != "1" ]; then
    echo "stage $name@$ver (npm doesn't have this package yet: approve it with 2FA)"
    (cd "$dir" && npm stage publish)
  else
    echo "ship  $name@$ver (first version: needs a token that may publish, or a local npm publish)"
    [ "$dry" = "1" ] && (cd "$dir" && npm publish --dry-run --access public --provenance) && continue
    (cd "$dir" && npm publish $flag --access public)
  fi
done