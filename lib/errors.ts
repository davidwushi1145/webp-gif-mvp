import { NextResponse } from "next/server";
import type { ErrorResponse } from "./types";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(error: unknown): NextResponse<ErrorResponse> {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  console.error("Unhandled request error", error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "服务器处理失败，请稍后重试。" } },
    { status: 500 },
  );
}

export function assertContentLength(
  request: Request,
  maximumBytes: number,
): void {
  const header = request.headers.get("content-length");
  if (!header) return;

  const length = Number(header);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new AppError(400, "INVALID_CONTENT_LENGTH", "请求长度无效。");
  }
  if (length > maximumBytes) {
    throw new AppError(413, "REQUEST_TOO_LARGE", "请求体超过允许大小。");
  }
}
