import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PROXY_RELATIVE = join("services", "private-graphql-proxy");
const VIRTUUS_STORE = join("proxy", "virtuus_store.py");
const STORE_FACTORY = join("proxy", "store_factory.py");

const VIRTUUS_PROXY_ERROR =
  "No Virtuus-capable private-graphql-proxy found. The proxy must include " +
  "proxy/virtuus_store.py and proxy/store_factory.py (Plexus PR #612). " +
  "Set PLEXUS_GRAPHQL_PROXY_DIR to a Virtuus checkout, for example " +
  "~/Projects/Plexus_worktrees/virtuus-store/services/private-graphql-proxy.";

/**
 * Resolve the installed `plexus` CLI from PATH (or PLEXUS_CLI override).
 */
export function resolvePlexusCli(): string {
  const explicit = process.env.PLEXUS_CLI?.trim();
  if (explicit) {
    return explicit;
  }

  const result = spawnSync("bash", ["-lc", "command -v plexus"], {
    encoding: "utf8",
  });
  const cliPath = result.stdout.trim();
  if (result.status === 0 && cliPath.length > 0) {
    return cliPath;
  }

  throw new Error(
    "plexus CLI not found on PATH. Install Plexus and ensure `plexus` is available (or set PLEXUS_CLI).",
  );
}

/**
 * Python interpreter aligned with the installed Plexus CLI when possible.
 */
export function resolvePythonForPlexus(): string {
  const explicit = process.env.PYTHON?.trim();
  if (explicit) {
    return explicit;
  }

  try {
    const plexusCli = resolvePlexusCli();
    const candidate = join(dirname(plexusCli), "python3");
    if (existsSync(candidate)) {
      return candidate;
    }
  } catch {
    // Fall through to python3 on PATH.
  }

  return "python3";
}

/**
 * True when the proxy checkout implements the Virtuus file-backed GraphQL store.
 */
export function isVirtuusCapableProxyDir(proxyDir: string): boolean {
  return (
    existsSync(join(proxyDir, VIRTUUS_STORE)) &&
    existsSync(join(proxyDir, STORE_FACTORY))
  );
}

function virtuusProxyCandidates(): string[] {
  const home = homedir();
  const candidates: string[] = [];

  const explicit = process.env.PLEXUS_GRAPHQL_PROXY_DIR?.trim();
  if (explicit) {
    candidates.push(explicit);
  }

  candidates.push(
    join(
      home,
      "Projects",
      "Plexus_worktrees",
      "virtuus-store",
      PROXY_RELATIVE,
    ),
  );

  const plexusRoot = process.env.PLEXUS_ROOT?.trim();
  if (plexusRoot) {
    candidates.push(join(plexusRoot, PROXY_RELATIVE));
  }

  candidates.push(
    join(home, "Projects", "Plexus", PROXY_RELATIVE),
    join(home, "projects", "Plexus", PROXY_RELATIVE),
  );

  return candidates;
}

/**
 * Locate a Virtuus-capable private-graphql-proxy checkout.
 * Returns null when no suitable proxy is available.
 */
export function resolveGraphqlProxyDir(): string | null {
  for (const candidate of virtuusProxyCandidates()) {
    if (isVirtuusCapableProxyDir(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function requireGraphqlProxyDir(): string {
  const proxyDir = resolveGraphqlProxyDir();
  if (!proxyDir) {
    throw new Error(VIRTUUS_PROXY_ERROR);
  }
  return proxyDir;
}

export function isPlexusCliAvailable(): boolean {
  try {
    resolvePlexusCli();
    return true;
  } catch {
    return false;
  }
}

export function isGraphqlProxyAvailable(): boolean {
  return resolveGraphqlProxyDir() !== null;
}
