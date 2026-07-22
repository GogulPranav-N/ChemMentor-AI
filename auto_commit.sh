#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# auto_commit.sh — Automatically commits any changes to the git repo.
#
# Usage:
#   Run manually:   bash auto_commit.sh
#   Schedule it:    Add to crontab — see bottom of this file.
#
# What it does:
#   1. Checks if there are any changes to commit (tracked or untracked)
#   2. If yes, stages everything (respecting .gitignore) and commits with
#      a timestamped message
#   3. If a remote is configured, pushes to origin/main
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_DIR="/Users/gogulpranav/Documents/Projects/Che-Mentor"
BRANCH="main"

cd "$REPO_DIR"

# Check if inside a git repo
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "[auto_commit] ERROR: Not a git repository: $REPO_DIR"
  exit 1
fi

# Check if there is anything to commit
if git diff --quiet && git diff --cached --quiet && \
   [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "[auto_commit] $(date '+%Y-%m-%d %H:%M:%S') — No changes. Skipping commit."
  exit 0
fi

# Stage all changes (respects .gitignore)
git add -A

# Build commit message with timestamp and a brief diff summary
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
CHANGED=$(git diff --cached --name-only | head -10 | tr '\n' ',' | sed 's/,$//')
COMMIT_MSG="chore: auto-commit @ ${TIMESTAMP}

Changed files: ${CHANGED}"

git commit -m "$COMMIT_MSG"
echo "[auto_commit] Committed: $COMMIT_MSG"

# Push if a remote named 'origin' exists
if git remote get-url origin &>/dev/null; then
  git push origin "$BRANCH"
  echo "[auto_commit] Pushed to origin/$BRANCH"
else
  echo "[auto_commit] No remote 'origin' configured — commit saved locally only."
fi

# ─────────────────────────────────────────────────────────────────────────────
# To schedule this script to run every 30 minutes, add the following line
# to your crontab (run `crontab -e` to edit):
#
#   */30 * * * * /bin/bash /Users/gogulpranav/Documents/Projects/Che-Mentor/auto_commit.sh >> /Users/gogulpranav/Documents/Projects/Che-Mentor/auto_commit.log 2>&1
#
# To run every hour:
#   0 * * * * /bin/bash /Users/gogulpranav/Documents/Projects/Che-Mentor/auto_commit.sh >> /Users/gogulpranav/Documents/Projects/Che-Mentor/auto_commit.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────
