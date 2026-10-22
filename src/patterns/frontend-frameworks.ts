export const FRONTEND_FRAMEWORK_HINTS = [
  "next_or_react_route",
  "nextjs",
  "react",
  "vue",
  "angular",
  "ionic",
  "electron",
  "svelte",
  "solid",
  "qwik",
] as const;

export const FRONTEND_FRAMEWORK_HINTS_SET = new Set<string>(
  FRONTEND_FRAMEWORK_HINTS,
);

export const PREFERRED_WEB_APP_FRAMEWORKS = new Set<string>([
  ...FRONTEND_FRAMEWORK_HINTS,
  "frontend",
]);

export const SERVER_FRAMEWORK_HINTS = new Set<string>([
  "nest",
  "express",
  "serverless",
]);

/**
 * Canonical framework ids. Detectors emit different spellings for the same
 * framework (`next_or_react_route` from route-handler files, `nextjs` from the
 * `next` dependency); both resolve to one id here.
 */
const FRAMEWORK_ALIASES: Readonly<Record<string, string>> = {
  next_or_react_route: "nextjs",
  next: "nextjs",
  "next.js": "nextjs",
  nextjs: "nextjs",
};

const FRAMEWORK_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  nextjs: "Next.js",
  react: "React",
  vue: "Vue",
  angular: "Angular",
  ionic: "Ionic",
  electron: "Electron",
  svelte: "Svelte",
  solid: "Solid",
  qwik: "Qwik",
  express: "Express",
  nest: "Nest",
  fastapi: "FastAPI",
  flask: "Flask",
  django: "Django",
};

export function canonicalFrameworkId(framework: string): string {
  const key = framework.trim().toLowerCase();
  return FRAMEWORK_ALIASES[key] ?? key;
}

/** Human-readable framework label, identical for every alias of one framework. */
export function frameworkDisplayName(framework: string): string {
  const id = canonicalFrameworkId(framework);
  const known = FRAMEWORK_DISPLAY_NAMES[id];
  if (known) return known;
  return id
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
