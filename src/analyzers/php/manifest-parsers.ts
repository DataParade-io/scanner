/**
 * Dependency extraction for Composer manifests.
 *
 * `composer.json` is the package root for a PHP service. Package names
 * (`guzzlehttp/guzzle`) are distinct from PSR namespaces (`GuzzleHttp\Client`)
 * — detectors match them via `packageNames` vs `importNamespaces`.
 */

import {
  jsonObjectKeySpans,
  type ManifestPackageSpan,
} from "../shared/manifest-span";

export interface ComposerManifest {
  /** `name` field, e.g. `acme/billing`. */
  name?: string;
  /** Package names from `require` and `require-dev`, one span per declaration line. */
  packages: ManifestPackageSpan[];
}

function isComposerPackageName(token: string): boolean {
  if (!token || token === "php" || token.startsWith("ext-")) return false;
  // Composer packages are `vendor/package`; platform reqs like `php` are skipped.
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(token);
}

export function parseComposerJson(content: string): ComposerManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { packages: [] };
  }

  if (!parsed || typeof parsed !== "object") {
    return { packages: [] };
  }

  const obj = parsed as {
    name?: unknown;
    require?: unknown;
    "require-dev"?: unknown;
  };

  const packages = jsonObjectKeySpans(
    content,
    ["require", "require-dev"],
    (key) => (isComposerPackageName(key) ? key : null),
  );

  const name =
    typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : undefined;

  return { name, packages };
}
