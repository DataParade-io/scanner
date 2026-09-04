import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

  // Use a non-login shell: bash -lc can print conda init noise before the path.
  const result = spawnSync("bash", ["-c", "command -v plexus"], {
    encoding: "utf8",
  });
  const cliPath = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (result.status === 0 && cliPath) {
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

/**
 * True when the proxy loads `.plexus/config.yaml` via Plexus ConfigLoader.
 */
export function isYamlConfigCapableProxyDir(proxyDir: string): boolean {
  const configPath = join(proxyDir, "proxy", "config.py");
  if (!existsSync(configPath)) {
    return false;
  }
  return readFileSync(configPath, "utf8").includes("load_config");
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
  const matches = virtuusProxyCandidates().filter(isVirtuusCapableProxyDir);
  if (matches.length === 0) {
    return null;
  }
  return matches.find(isYamlConfigCapableProxyDir) ?? matches[0];
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

/**
 * True when the installed Plexus package exposes SubjectIdentityScore.
 */
export function isSubjectIdentityScoreAvailable(): boolean {
  try {
    const python = resolvePythonForPlexus();
    const result = spawnSync(
      python,
      [
        "-c",
        "from plexus.scores.SubjectIdentityScore import SubjectIdentityScore",
      ],
      { encoding: "utf8" },
    );
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * True when the installed Plexus Python package exposes a Score class by name.
 */
export function isPlexusScoreClassAvailable(scoreClass: string): boolean {
  try {
    const python = resolvePythonForPlexus();
    const result = spawnSync(
      python,
      [
        "-c",
        `from plexus.scores import resolve_score_class; resolve_score_class(${JSON.stringify(scoreClass)})`,
      ],
      { encoding: "utf8" },
    );
    return result.status === 0;
  } catch {
    return false;
  }
}

export function isGraphqlProxyAvailable(): boolean {
  return resolveGraphqlProxyDir() !== null;
}

export interface LocalGraphqlRuntimeOptions {
  dataDir?: string;
  host?: string;
  port?: number;
  proxyDir?: string;
}

const STATIC_PLEXUS_ENV_KEYS = [
  "PLEXUS_STORE",
  "PLEXUS_BACKEND_MODE",
  "PLEXUS_PROXY_AUTH_MODE",
  "PLEXUS_PROXY_UPSTREAM_DISABLED",
  "PLEXUS_PROXY_DATABASE_URL",
  "PLEXUS_VIRTUUS_DATA_DIR",
] as const;

/**
 * Environment for spawning scripts/start-local-graphql.sh.
 * Static Plexus settings come from .plexus/config.yaml; only proxy checkout,
 * Python, and per-run data_dir / host / port are passed here.
 */
export function buildLocalGraphqlChildEnv(
  options: LocalGraphqlRuntimeOptions = {},
): NodeJS.ProcessEnv {
  const proxyDir = options.proxyDir ?? requireGraphqlProxyDir();
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of STATIC_PLEXUS_ENV_KEYS) {
    delete env[key];
  }

  env.PLEXUS_GRAPHQL_PROXY_DIR = proxyDir;
  env.PYTHON = resolvePythonForPlexus();

  if (options.dataDir) {
    env.PLEXUS_DATA_DIR = options.dataDir;
  }
  if (options.host) {
    env.PLEXUS_GRAPHQL_HOST = options.host;
  }
  if (options.port !== undefined) {
    env.PLEXUS_GRAPHQL_PORT = String(options.port);
  }

  return env;
}
