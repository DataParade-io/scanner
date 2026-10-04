import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PROXY_RELATIVE = join("services", "private-graphql-proxy");
const VIRTUUS_STORE = join("proxy", "virtuus_store.py");
const STORE_FACTORY = join("proxy", "store_factory.py");

const VIRTUUS_PROXY_ERROR =
  "No Virtuus-capable private-graphql-proxy found. The proxy must include " +
  "proxy/virtuus_store.py and proxy/store_factory.py (Primus PR #612). " +
  "Set PRIMUS_GRAPHQL_PROXY_DIR to a Virtuus checkout, for example " +
  "~/Projects/Primus_worktrees/virtuus-store/services/private-graphql-proxy.";

/**
 * Resolve the installed `primus` CLI from PATH (or PRIMUS_CLI override).
 */
export function resolvePrimusCli(): string {
  const explicit = process.env.PRIMUS_CLI?.trim();
  if (explicit) {
    return explicit;
  }

  // Use a non-login shell: bash -lc can print conda init noise before the path.
  const result = spawnSync("bash", ["-c", "command -v primus"], {
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
    "primus CLI not found on PATH. Install Primus and ensure `primus` is available (or set PRIMUS_CLI).",
  );
}

/**
 * Python interpreter aligned with the installed Primus CLI when possible.
 */
export function resolvePythonForPrimus(): string {
  const explicit = process.env.PYTHON?.trim();
  if (explicit) {
    return explicit;
  }

  try {
    const primusCli = resolvePrimusCli();
    const candidate = join(dirname(primusCli), "python3");
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
 * True when the proxy loads `.primus/config.yaml` via Primus ConfigLoader.
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

  const explicit = process.env.PRIMUS_GRAPHQL_PROXY_DIR?.trim();
  if (explicit) {
    candidates.push(explicit);
  }

  candidates.push(
    join(
      home,
      "Projects",
      "Primus_worktrees",
      "virtuus-store",
      PROXY_RELATIVE,
    ),
  );

  const primusRoot = process.env.PRIMUS_ROOT?.trim();
  if (primusRoot) {
    candidates.push(join(primusRoot, PROXY_RELATIVE));
  }

  candidates.push(
    join(home, "Projects", "Primus", PROXY_RELATIVE),
    join(home, "projects", "Primus", PROXY_RELATIVE),
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

export function isPrimusCliAvailable(): boolean {
  try {
    resolvePrimusCli();
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the installed Primus package exposes SubjectIdentityScore.
 */
export function isSubjectIdentityScoreAvailable(): boolean {
  try {
    const python = resolvePythonForPrimus();
    const result = spawnSync(
      python,
      [
        "-c",
        "from primus.scores.SubjectIdentityScore import SubjectIdentityScore",
      ],
      { encoding: "utf8" },
    );
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * True when the installed Primus Python package exposes a Score class by name.
 */
export function isPrimusScoreClassAvailable(scoreClass: string): boolean {
  try {
    const python = resolvePythonForPrimus();
    const result = spawnSync(
      python,
      [
        "-c",
        `from primus.scores import resolve_score_class; resolve_score_class(${JSON.stringify(scoreClass)})`,
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

const STATIC_PRIMUS_ENV_KEYS = [
  "PRIMUS_STORE",
  "PRIMUS_BACKEND_MODE",
  "PRIMUS_PROXY_AUTH_MODE",
  "PRIMUS_PROXY_UPSTREAM_DISABLED",
  "PRIMUS_PROXY_DATABASE_URL",
  "PRIMUS_VIRTUUS_DATA_DIR",
] as const;

/**
 * Environment for spawning scripts/start-local-graphql.sh.
 * Static Primus settings come from .primus/config.yaml; only proxy checkout,
 * Python, and per-run data_dir / host / port are passed here.
 */
export function buildLocalGraphqlChildEnv(
  options: LocalGraphqlRuntimeOptions = {},
): NodeJS.ProcessEnv {
  const proxyDir = options.proxyDir ?? requireGraphqlProxyDir();
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of STATIC_PRIMUS_ENV_KEYS) {
    delete env[key];
  }

  env.PRIMUS_GRAPHQL_PROXY_DIR = proxyDir;
  env.PYTHON = resolvePythonForPrimus();

  if (options.dataDir) {
    env.PRIMUS_DATA_DIR = options.dataDir;
  }
  if (options.host) {
    env.PRIMUS_GRAPHQL_HOST = options.host;
  }
  if (options.port !== undefined) {
    env.PRIMUS_GRAPHQL_PORT = String(options.port);
  }

  return env;
}
