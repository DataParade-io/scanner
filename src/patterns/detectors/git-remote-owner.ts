import fs from "fs";
import path from "path";

/**
 * The owner (user or organization) of the scanned repository's `origin` remote, read from
 * the git config (DATAP-818). It is one more conservative first-party signal: a host whose
 * registrable-domain label matches the owner name is the organization's own service.
 */
export function readGitRemoteOwner(startDir: string): string | undefined {
  const config = findGitConfig(startDir);
  if (!config) return undefined;
  let text: string;
  try {
    text = fs.readFileSync(config, "utf8");
  } catch {
    return undefined;
  }
  const url = originUrl(text);
  return url ? ownerFromRemoteUrl(url) : undefined;
}

/** Path of the git config for `startDir` or its nearest ancestor (worktrees included). */
function findGitConfig(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const dotGit = path.join(dir, ".git");
    try {
      const st = fs.statSync(dotGit);
      if (st.isDirectory()) return path.join(dotGit, "config");
      if (st.isFile()) {
        // Worktree or submodule: `gitdir: <path>`; the shared config is in the common dir.
        const gitdir = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"))?.[1]?.trim();
        if (!gitdir) return undefined;
        const resolved = path.resolve(dir, gitdir);
        const commondirFile = path.join(resolved, "commondir");
        const common = fs.existsSync(commondirFile)
          ? path.resolve(resolved, fs.readFileSync(commondirFile, "utf8").trim())
          : resolved;
        return path.join(common, "config");
      }
    } catch {
      // No .git here: keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function originUrl(config: string): string | undefined {
  let inOrigin = false;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inOrigin = /^\[remote\s+"origin"\]$/.test(line);
      continue;
    }
    if (!inOrigin) continue;
    const m = /^url\s*=\s*(.+)$/.exec(line);
    if (m) return m[1].trim();
  }
  return undefined;
}

/** `git@github.com:Acme/repo.git`, `https://github.com/Acme/repo` -> `Acme`. */
export function ownerFromRemoteUrl(url: string): string | undefined {
  const scp = /^[^@/\s]+@[^:/\s]+:([^/\s]+)\/[^/\s]+$/.exec(url);
  if (scp) return scp[1];
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : undefined;
  } catch {
    return undefined;
  }
}

const ORG_SUFFIXES = ["labs", "inc", "app", "ai", "hq", "io"];

/**
 * Comparable organization name: lowercase, alphanumerics only, common suffixes removed
 * (`Acme-Widgets-AI` -> `acmewidgets`). A suffix is removed only when at least three
 * characters remain.
 */
export function normalizeOrganizationName(name: string): string {
  let key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of ORG_SUFFIXES) {
      if (key.endsWith(suffix) && key.length - suffix.length >= 3) {
        key = key.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return key;
}
