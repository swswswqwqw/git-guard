import { check } from "../hooks/claude-pretooluse.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (name, cond) => { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) fail++; };

// --- Claude hook ---
const denied = [
  'git commit -m "x"', 'git add -A && git commit -m "x" -- a.txt', 'git add .', 'git commit -am "x"',
  'git commit -a -m "x"', 'git reset --hard HEAD~1', 'git clean -fd', 'git checkout -- .', 'git restore .',
  'git add -A; git commit -m y -- a',
  'git push --force', 'git push -f origin main', 'git push origin +main', 'git push -uf origin feat',
];
const allowed = [
  'git commit -m "x" -- a.txt', 'git add src/a.ts', 'git status', 'git commit -m "fix -a thing" -- a.txt',
  'git restore --staged -- a.txt', 'git log --oneline', 'git commit --only -m "x" a.txt', 'ls -a',
  'git push', 'git push origin main', 'git push --force-with-lease origin feat', 'git push -u origin feat',
];
for (const c of denied) ok("deny: " + c, check(c).length > 0);
for (const c of allowed) ok("allow: " + c, check(c).length === 0);

// --- pre-commit ---
const repo = mkdtempSync(join(tmpdir(), "gg-"));
const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });
git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
mkdirSync(join(repo, "a")); mkdirSync(join(repo, "b"));
writeFileSync(join(repo, "a/1.txt"), "1"); writeFileSync(join(repo, "b/2.txt"), "2");
git("add", "."); git("commit", "-qm", "init");
mkdirSync(join(repo, ".git/hooks"), { recursive: true });
const hook = join(repo, ".git/hooks/pre-commit");
copyFileSync(join(here, "../hooks/pre-commit"), hook); chmodSync(hook, 0o755);
const tryCommit = (env = {}) => spawnSync("git", ["commit", "-qm", "t"], { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } });

writeFileSync(join(repo, "a/1.txt"), "changed"); git("rm", "-q", "b/2.txt"); git("add", "a/1.txt");
let r = tryCommit({ GIT_GUARD_SCOPE: "a" });
ok("out-of-scope staged deletion blocks", r.status === 1 && /b\/2\.txt/.test(r.stderr));
git("restore", "--staged", "b/2.txt"); git("restore", "b/2.txt");
git("add", "a/1.txt"); r = tryCommit({ GIT_GUARD_SCOPE: "a" });
ok("scoped commit with only in-scope files passes", r.status === 0);
git("rm", "-q", "b/2.txt"); r = tryCommit();
ok("no scope: deletion warns but passes", r.status === 0 && /staged deletions/.test(r.stderr));
git("reset", "-q", "--hard", "HEAD~0"); git("checkout", "-q", "HEAD~1", "--", "b/2.txt"); git("commit", "-qm", "restore");
git("rm", "-q", "b/2.txt"); r = tryCommit({ GIT_GUARD_STRICT: "1" });
ok("strict: deletion blocks", r.status === 1);
r = tryCommit({ GIT_GUARD_STRICT: "1", GIT_GUARD_SKIP: "1" });
ok("skip bypasses", r.status === 0);

// --- symlink / submodule crossings (index entries built directly so this runs on Windows too) ---
const addLink = (path, target) => {
  const sha = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo, input: target, encoding: "utf8" }).trim();
  git("update-index", "--add", "--cacheinfo", "120000," + sha + "," + path);
};
git("reset", "-q", "--hard", "HEAD");
addLink("a/inside", "1.txt");
r = tryCommit({ GIT_GUARD_SCOPE: "a" });
ok("symlink inside scope passes", r.status === 0);
addLink("a/escape", "../b/2.txt");
r = tryCommit({ GIT_GUARD_SCOPE: "a" });
ok("symlink escaping scope blocks", r.status === 1 && r.stderr.includes("a/escape -> ../b/2.txt"));
git("reset", "-q", "--hard", "HEAD");
addLink("a/abs", "/etc/passwd");
r = tryCommit({ GIT_GUARD_SCOPE: "a" });
ok("absolute symlink blocks", r.status === 1);
git("reset", "-q", "--hard", "HEAD");
addLink("a/up", "../../outside");
r = tryCommit({ GIT_GUARD_SCOPE: "a" });
ok("symlink climbing above repo root blocks", r.status === 1);
git("reset", "-q", "--hard", "HEAD");
addLink("b/esc2", "../b/2.txt");
r = tryCommit({ GIT_GUARD_SCOPE: "a", GIT_GUARD_SKIP: "1" });
ok("skip bypasses symlink check", r.status === 0);
git("update-index", "--add", "--cacheinfo", "160000,1111111111111111111111111111111111111111,a/sub");
r = tryCommit({ GIT_GUARD_SCOPE: "a" });
ok("submodule pointer in scope warns but passes", r.status === 0 && /submodule pointer/.test(r.stderr));
git("update-index", "--add", "--cacheinfo", "160000,2222222222222222222222222222222222222222,a/sub");
r = tryCommit({ GIT_GUARD_SCOPE: "a", GIT_GUARD_STRICT: "1" });
ok("submodule pointer under STRICT blocks", r.status === 1);

// --- .gitignore negation with an excluded parent ---
const setIgnore = (body) => { writeFileSync(join(repo, ".gitignore"), body); git("add", ".gitignore"); };
git("reset", "-q", "--hard", "HEAD");
setIgnore("build/\n!build/keep.txt\n");
r = tryCommit({ GIT_GUARD_SCOPE: ".gitignore" });
ok("dead gitignore negation warns but passes", r.status === 0 && r.stderr.includes("negation") && r.stderr.includes("build/keep.txt"));
setIgnore("build/*\n!build/keep.txt\n");
r = tryCommit({ GIT_GUARD_SCOPE: ".gitignore" });
ok("working gitignore negation is silent", r.status === 0 && !r.stderr.includes("negation"));
setIgnore("build/\n!build/keep.txt\n");
r = tryCommit({ GIT_GUARD_SCOPE: ".gitignore", GIT_GUARD_STRICT: "1" });
ok("dead gitignore negation blocks under STRICT", r.status === 1);
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
