---
name: git-commit
description: Stage all changes and create a conventional commit. The user provides
  the prefix (e.g. fix, feat, docs). The commit message is inferred from git diff.
---

# Git Commit

## Steps

1. Run `git --no-pager diff HEAD` to understand what changed.
2. Stage everything: `git add -A`
3. Write a short, imperative-mood commit message based on the diff, no coauthored, no long explanations; then commit:
   `git commit -m "<prefix>: <message inferred from diff>"` where prefix is $0
4. Run `git log --oneline -1` and show the user the result.

