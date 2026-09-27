#!/bin/sh
# Install git-guard's pre-commit hook into the current repo.
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(git rev-parse --show-toplevel)
dest="$root/.git/hooks/pre-commit"
if [ -e "$dest" ] && ! grep -q "git-guard" "$dest"; then
  echo "A different pre-commit hook already exists at $dest. Not overwriting." >&2
  echo "Append this line to it instead:  sh \"$here/hooks/pre-commit\" || exit 1" >&2
  exit 1
fi
cp "$here/hooks/pre-commit" "$dest" && chmod +x "$dest"
echo "Installed pre-commit hook. Optional: create $root/.git-guard-scope with one path prefix per line."
echo "Claude Code hook: see README ('Claude Code hook')."
