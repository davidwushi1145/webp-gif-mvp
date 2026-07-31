import { MAX_PENDING_CONVERSIONS } from "./config";
import { AppError } from "./errors";

let tail: Promise<void> = Promise.resolve();
const queuedOrActiveJobs = new Set<string>();

export async function withConversionLock<T>(
  jobId: string,
  task: () => Promise<T>,
): Promise<T> {
  if (queuedOrActiveJobs.has(jobId)) {
    throw new AppError(409, "JOB_ALREADY_QUEUED", "该任务正在转换，请勿重复提交。");
  }
  if (queuedOrActiveJobs.size >= MAX_PENDING_CONVERSIONS) {
    throw new AppError(429, "CONVERSION_QUEUE_FULL", "转换队列已满，请稍后重试。");
  }

  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  const previous = tail;
  tail = current;
  queuedOrActiveJobs.add(jobId);

  await previous;

  try {
    return await task();
  } finally {
    queuedOrActiveJobs.delete(jobId);
    release();
  }
}

export function isConversionQueuedOrActive(jobId: string): boolean {
  return queuedOrActiveJobs.has(jobId);
}
