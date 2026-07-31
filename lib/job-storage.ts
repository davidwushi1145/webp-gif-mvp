import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { IMAGE_LIMITS, getJobRoot } from "./config";
import { isConversionQueuedOrActive } from "./conversion-lock";
import { AppError } from "./errors";
import type { JobDocument } from "./types";

export const JOB_FILES = {
  upload: "upload.tmp",
  input: "input.webp",
  analysis: "analysis.json",
  output: "output.gif",
  report: "report.json",
} as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidJobId(jobId: string): boolean {
  return UUID_PATTERN.test(jobId);
}

export function assertValidJobId(jobId: string): void {
  if (!isValidJobId(jobId)) {
    throw new AppError(400, "INVALID_JOB_ID", "任务 ID 无效。");
  }
}

export function getJobDirectory(jobId: string): string {
  assertValidJobId(jobId);
  const root = getJobRoot();
  const directory = path.resolve(/*turbopackIgnore: true*/ root, jobId);
  const relative = path.relative(root, directory);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AppError(400, "INVALID_JOB_ID", "任务 ID 无效。");
  }
  return directory;
}

export function getJobFile(
  jobId: string,
  file: (typeof JOB_FILES)[keyof typeof JOB_FILES],
): string {
  return path.join(/*turbopackIgnore: true*/ getJobDirectory(jobId), file);
}

export async function createJobDirectory(): Promise<{
  jobId: string;
  directory: string;
}> {
  await mkdir(getJobRoot(), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const jobId = randomUUID();
    const directory = getJobDirectory(jobId);
    try {
      await mkdir(directory, { mode: 0o700 });
      return { jobId, directory };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  throw new AppError(500, "JOB_CREATE_FAILED", "无法创建转换任务。");
}

export function safeOriginalName(name: string): string {
  const cleaned = path
    .basename(name || "input.webp")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 160);
  return cleaned || "input.webp";
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function loadJobDocument(jobId: string): Promise<JobDocument> {
  const file = getJobFile(jobId, JOB_FILES.analysis);
  let raw: string;
  try {
    raw = await readFile(/*turbopackIgnore: true*/ file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AppError(404, "JOB_NOT_FOUND", "任务不存在或已过期。");
    }
    throw error;
  }

  let document: JobDocument;
  try {
    document = JSON.parse(raw) as JobDocument;
  } catch {
    throw new AppError(404, "JOB_NOT_FOUND", "任务不存在或已过期。");
  }

  if (
    document.version !== 1 ||
    document.jobId !== jobId ||
    !document.analysis ||
    !Number.isFinite(Date.parse(document.expiresAt))
  ) {
    throw new AppError(404, "JOB_NOT_FOUND", "任务不存在或已过期。");
  }

  if (Date.parse(document.expiresAt) <= Date.now()) {
    if (!isConversionQueuedOrActive(jobId)) {
      await removeJob(jobId).catch(() => undefined);
    }
    throw new AppError(404, "JOB_EXPIRED", "任务已过期，请重新上传文件。");
  }

  return document;
}

export async function assertArtifactExists(filePath: string): Promise<void> {
  try {
    await access(/*turbopackIgnore: true*/ filePath);
  } catch {
    throw new AppError(404, "ARTIFACT_NOT_FOUND", "转换结果尚不存在或已过期。");
  }
}

export async function removeJob(jobId: string): Promise<void> {
  const directory = getJobDirectory(jobId);
  await rm(directory, { recursive: true, force: true });
}

export async function cleanupExpiredJobs(now = Date.now()): Promise<number> {
  const root = getJobRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const entries = await readdir(root, { withFileTypes: true });
  let removed = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidJobId(entry.name)) continue;
    if (isConversionQueuedOrActive(entry.name)) continue;

    const directory = getJobDirectory(entry.name);
    let expiresAt = 0;
    try {
      const raw = await readFile(
        /*turbopackIgnore: true*/ path.join(directory, JOB_FILES.analysis),
        "utf8",
      );
      const document = JSON.parse(raw) as Partial<JobDocument>;
      expiresAt = Date.parse(document.expiresAt ?? "");
      if (!Number.isFinite(expiresAt)) {
        const directoryStat = await stat(directory);
        expiresAt = directoryStat.mtimeMs + IMAGE_LIMITS.jobTtlMs;
      }
    } catch {
      const directoryStat = await stat(directory);
      expiresAt = directoryStat.mtimeMs + IMAGE_LIMITS.jobTtlMs;
    }

    if (Number.isFinite(expiresAt) && expiresAt <= now) {
      await rm(directory, { recursive: true, force: true });
      removed += 1;
    }
  }

  return removed;
}
