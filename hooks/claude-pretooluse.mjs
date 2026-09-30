#!/usr/bin/env node
// git-guard: Claude Code PreToolUse hook (matcher: Bash).
// Denies git commands that sweep in changes from other sessions.
// Zero dependencies. Bypass: GIT_GUARD_HOOK_OFF=1 in the environment.

export function check(command) {
  const problems = [];
  const stripped = command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  const parts = stripped.split(/&&|\|\||;|\n|\|/).map((s) => s.trim());
  for (const p of parts) {
    const m = p.match(/^(?:\w+=\S+\s+)*git\s+(?:-[cC]\s+\S+\s+)*(\S+)([\s\S]*)$/);
    if (!m) continue;
    const [, sub, rest] = m;
    const args = rest.trim();
    if (sub === "add") {
      if (/(^|\s)(-A|--all|-u|--update|\.)(\s|$)/.test(args) || /(^|\s)\*(\s|$)/.test(args)) {
        problems.push("`git add` of everything stages other sessions' changes too. Add explicit paths.");
      }
    } else if (sub === "commit") {
      const hasPathspec = /\s--\s+\S/.test(" " + args) || /(^|\s)(-o|--only)(\s|$)/.test(args);
      if (/(^|\s)(-[a-zA-Z]*a[a-zA-Z]*|--all)(\s|$)/.test(args)) {
        problems.push("`git commit -a` commits every tracked change, including other sessions'. Use explicit paths.");
      } else if (!hasPathspec) {
        problems.push(
          "`git commit` without a pathspec commits the WHOLE index, including anything another session staged. Use `git commit -m ... -- <your paths>`."
        );
      }
    } else if (sub === "reset" && /--hard/.test(args)) {
      problems.push("`git reset --hard` discards uncommitted work that may belong to another session.");
    } else if (sub === "clean" && /(^|\s)-[a-zA-Z]*f/.test(args)) {
      problems.push("`git clean -f` deletes untracked files that may belong to another session.");
    } else if (sub === "checkout" && /(^|\s)--\s+\.(\s|$)|(^|\s)\.(\s|$)/.test(args) && /--/.test(args)) {
      problems.push("`git checkout -- .` overwrites uncommitted work in the whole tree.");
    } else if (sub === "restore" && /(^|\s)\.(\s|$)/.test(args) && !/--staged/.test(args)) {
      problems.push("`git restore .` overwrites uncommitted work in the whole tree.");
    } else if (
      sub === "push" &&
      (/(^|\s)(--force|-[a-zA-Z]*f[a-zA-Z]*)(\s|$)/.test(args) || /(^|\s)\+\S/.test(args))
    ) {
      problems.push(
        "Force-push overwrites commits another session may have pushed. Use `git push --force-with-lease` if you must rewrite."
      );
    }
  }
  return problems;
}

async function main() {
  if (process.env.GIT_GUARD_HOOK_OFF === "1") return;
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (input.tool_name !== "Bash") return;
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== "string") return;
  const problems = check(command);
  if (problems.length === 0) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "git-guard: " + problems.join(" ") + " (Multiple sessions may share this repo. Set GIT_GUARD_HOOK_OFF=1 to bypass.)",
      },
    })
  );
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
