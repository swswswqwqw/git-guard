# git-guard

Stop one AI coding session from committing (or deleting) another session's work.

If you run more than one Claude Code / AI coding session against the same repo — parallel worktrees, cloud + local, several agents, or a synced folder shared by two machines — there's a quiet failure mode:

```
git add path/to/my-file      # scoped correctly
git commit -m "my change"    # no pathspec -> commits the WHOLE index
```

Anything another process staged in the meantime rides along in your commit. If it was a deletion, a file silently disappears from `main`. Nothing errors. You find out days later.

git-guard is two small, dependency-free hooks that make this class of mistake loud:

1. **`pre-commit`** (POSIX sh) — blocks a commit whose staged paths fall outside the scope you declared, and flags staged deletions.
2. **Claude Code `PreToolUse` hook** (Node, no packages) — denies `git commit` with no pathspec, `git add -A/.`, `git commit -a`, `git reset --hard`, `git clean -f`, `git checkout -- .` *before the agent runs them*, and tells the agent what to do instead.

## Install

```sh
git clone https://github.com/swswswqwqw/git-guard.git
cd your-project
sh ../git-guard/install.sh
```

### Declare your scope (optional but recommended)

`.git-guard-scope` at the repo root, one path prefix per line:

```
# this session only touches these
src/billing
docs/billing
```

Or per commit: `GIT_GUARD_SCOPE="src/billing:docs/billing" git commit ...`

- Scope set → any staged path outside it **blocks** the commit and lists the offenders.
- No scope → staged deletions are listed as a warning. `GIT_GUARD_STRICT=1` makes that a block.
- Bypass once when you're sure: `GIT_GUARD_SKIP=1 git commit ...`

### Claude Code hook

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node /path/to/git-guard/hooks/claude-pretooluse.mjs" }]
      }
    ]
  }
}
```

The denial message is written for the agent: it tells it to commit with explicit paths (`git commit -m "..." -- <paths>`). Bypass with `GIT_GUARD_HOOK_OFF=1`.

## What it does not do

- It doesn't create worktrees or orchestrate agents. Use whatever you already use (worktrees, Superset, Conductor…) — this sits next to it as a safety net.
- It can't see uncommitted work in a *different* clone. It guards the index and working tree of the repo it's installed in.
- The Claude Code hook is a pattern check on the command string, not a shell parser. It will miss exotic invocations (e.g. a git command hidden inside a script).

## Tests

```sh
node test/run.mjs
```

## Feedback

Built after a real incident: an unrelated commit swept another process's staged deletion into `main`. If you've hit something similar — or a case this misses — open an issue.
