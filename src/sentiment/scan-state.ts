import fs from "fs";
import path from "path";

/**
 * Incremental re-scan state. The store persists watermarks, fingerprints, and
 * counts only — never message text.
 */
export interface ScanWatermark {
  path: string;
  /** Identity fingerprint: size + mtime at last scan. */
  size: number;
  mtimeMs: number;
  /** JSONL sources: number of lines already consumed. */
  linesSeen?: number;
  /** SQLite sources: max seen createdAt (epoch ms) with an overlap margin. */
  maxSeenCreatedAt?: number;
}

export interface ScanState {
  version: 1;
  watermarks: Record<string, ScanWatermark>;
}

const OVERLAP_MARGIN_MS = 60_000;

export function defaultCacheDir(): string {
  if (process.env.DATAPARADE_CACHE_DIR) return process.env.DATAPARADE_CACHE_DIR;
  const xdg = process.env.XDG_CACHE_HOME || path.join(process.env.HOME || "", ".cache");
  return path.join(xdg, "dataparade", "sentiment");
}

export function scanStatePath(cacheDir: string): string {
  return path.join(cacheDir, "scan-state.json");
}

export function loadScanState(cacheDir: string): ScanState {
  try {
    const raw = fs.readFileSync(scanStatePath(cacheDir), "utf8");
    const parsed = JSON.parse(raw) as ScanState;
    if (parsed && parsed.version === 1 && typeof parsed.watermarks === "object") {
      return parsed;
    }
  } catch {
    // Missing or corrupt state means a full rescan.
  }
  return { version: 1, watermarks: {} };
}

export function saveScanState(cacheDir: string, state: ScanState): void {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(scanStatePath(cacheDir), JSON.stringify(state, null, 2));
}

export function clearScanStateForTest(cacheDir: string): void {
  fs.rmSync(scanStatePath(cacheDir), { force: true });
}

/**
 * Decide which lines of an append-only JSONL file still need reading.
 * A file that shrank or changed identity since the last scan forces a full
 * rescan of that file; an appended file resumes at the recorded line.
 */
export function jsonlRescanRange(
  watermark: ScanWatermark | undefined,
  stats: fs.Stats,
): { fromLine: number; readAll: boolean } {
  if (!watermark) return { fromLine: 0, readAll: true };
  if (stats.size < watermark.size || stats.mtimeMs < watermark.mtimeMs) {
    return { fromLine: 0, readAll: true };
  }
  return { fromLine: watermark.linesSeen ?? 0, readAll: false };
}

/**
 * Decide the createdAt lower bound for a SQLite-backed source. A small overlap
 * margin re-reads recent rows so rows written between scans are caught even
 * when clock resolution is coarse; dedup absorbs the overlap.
 */
export function sqliteRescanFloor(
  watermark: ScanWatermark | undefined,
  stats: fs.Stats,
): { floor: number; readAll: boolean } {
  if (!watermark) return { floor: 0, readAll: true };
  if (stats.size < watermark.size || stats.mtimeMs < watermark.mtimeMs) {
    return { floor: 0, readAll: true };
  }
  return {
    floor: Math.max(0, (watermark.maxSeenCreatedAt ?? 0) - OVERLAP_MARGIN_MS),
    readAll: false,
  };
}

export function recordScanWatermark(
  state: ScanState,
  watermark: ScanWatermark,
): void {
  state.watermarks[watermark.path] = watermark;
}

export function updateScanWatermark(
  state: ScanState,
  input: {
    path: string;
    size: number;
    mtimeMs: number;
    linesSeen?: number;
    maxSeenCreatedAt?: number;
  },
): void {
  state.watermarks[input.path] = {
    path: input.path,
    size: input.size,
    mtimeMs: input.mtimeMs,
    linesSeen: input.linesSeen,
    maxSeenCreatedAt: input.maxSeenCreatedAt,
  };
}
