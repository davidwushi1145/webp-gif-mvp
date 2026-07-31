import path from "node:path";

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export const IMAGE_LIMITS = {
  maxUploadBytes: positiveIntegerFromEnv(
    "MAX_UPLOAD_BYTES",
    50 * 1024 * 1024,
  ),
  maxWidth: positiveIntegerFromEnv("MAX_IMAGE_WIDTH", 4096),
  maxHeight: positiveIntegerFromEnv("MAX_IMAGE_HEIGHT", 4096),
  maxFrames: positiveIntegerFromEnv("MAX_IMAGE_FRAMES", 600),
  maxDurationMs: positiveIntegerFromEnv("MAX_DURATION_MS", 120_000),
  maxTotalPixels: positiveIntegerFromEnv("MAX_TOTAL_PIXELS", 50_000_000),
  jobTtlMs: positiveIntegerFromEnv("JOB_TTL_MS", 24 * 60 * 60 * 1000),
} as const;

export const MAX_MULTIPART_BYTES = IMAGE_LIMITS.maxUploadBytes + 1024 * 1024;
export const MAX_JSON_BYTES = 16 * 1024;
export const MAX_PENDING_CONVERSIONS = positiveIntegerFromEnv(
  "MAX_PENDING_CONVERSIONS",
  3,
);

export function getJobRoot(): string {
  const root = path.resolve(
    /*turbopackIgnore: true*/
    process.env.JOB_ROOT ?? path.join(process.cwd(), "data", "jobs"),
  );
  if (root === path.parse(root).root) {
    throw new Error("JOB_ROOT must not be the filesystem root");
  }
  return root;
}
