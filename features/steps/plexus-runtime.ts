import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PROXY_RELATIVE = join("services", "private-graphql-proxy");
const PROXY_APP = join("proxy", "app.py");

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
 * Locate private-graphql-proxy without requiring PLEXUS_ROOT.
 * Returns null when the proxy checkout is not available.
 */
export function resolveGraphqlProxyDir(): string | null {
  const explicit = process.env.PLEXUS_GRAPHQL_PROXY_DIR?.trim();
  if (explicit && existsSync(join(explicit, PROXY_APP))) {
    return explicit;
  }

  const plexusRoot = process.env.PLEXUS_ROOT?.trim();
  if (plexusRoot) {
    const fromRoot = join(plexusRoot, PROXY_RELATIVE);
    if (existsSync(join(fromRoot, PROXY_APP))) {
      return fromRoot;
    }
  }

  const home = homedir();
  const candidates = [
    join(home, "projects", "Plexus", PROXY_RELATIVE),
    join(home, "Projects", "Plexus", PROXY_RELATIVE),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, PROXY_APP))) {
      return candidate;
    }
  }

  return null;
}

export function requireGraphqlProxyDir(): string {
  const proxyDir = resolveGraphqlProxyDir();
  if (!proxyDir) {
    throw new Error(
      "private-graphql-proxy not found. Set PLEXUS_GRAPHQL_PROXY_DIR to the proxy checkout " +
        "(services/private-graphql-proxy), or clone Plexus under ~/projects/Plexus.",
    );
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
