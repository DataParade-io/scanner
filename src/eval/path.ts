/**
 * Repo-relative path contract at the evaluator boundary (KDATAP-2b9787).
 */

export function isEvalPathContractValid(filePath: string): boolean {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed.includes("\0")) {
    return false;
  }

  const posix = trimmed.replace(/\\/g, "/");
  if (posix.startsWith("/")) {
    return false;
  }
  if (/^[a-zA-Z]:/.test(posix)) {
    return false;
  }

  const segments = posix.replace(/^\.\/+/, "").split("/");
  if (segments.some((segment) => segment === "..")) {
    return false;
  }
  if (segments.some((segment) => segment.length === 0)) {
    return false;
  }
  if (segments.length === 1 && segments[0] === ".") {
    return false;
  }

  return true;
}

export function normalizeEvalPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

/** Census helper — splits `prefix:rest` identity keys without alias tables. */
export function parseIdentityKey(key: string): { prefix: string; rest: string } {
  const trimmed = key.trim();
  const separator = trimmed.indexOf(":");
  if (separator === -1) {
    return { prefix: "", rest: trimmed.toLowerCase() };
  }
  return {
    prefix: trimmed.slice(0, separator).trim().toLowerCase(),
    rest: trimmed.slice(separator + 1).trim().toLowerCase(),
  };
}
