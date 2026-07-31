import Busboy from "busboy";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { IMAGE_LIMITS, MAX_MULTIPART_BYTES } from "./config";
import { AppError } from "./errors";
import { JOB_FILES, safeOriginalName } from "./job-storage";
import path from "node:path";

export interface StoredUpload {
  path: string;
  originalName: string;
  bytes: number;
}

export async function streamMultipartUpload(
  request: Request,
  jobDirectory: string,
): Promise<StoredUpload> {
  if (!request.body) {
    throw new AppError(400, "MISSING_BODY", "请求中没有上传文件。");
  }

  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: Object.fromEntries(request.headers.entries()),
      limits: {
        fileSize: IMAGE_LIMITS.maxUploadBytes,
        files: 1,
        fields: 0,
        // Busboy emits partsLimit as soon as this threshold is reached, so keep
        // one spare slot while fields/files limits still enforce one file only.
        parts: 2,
      },
    });
  } catch {
    throw new AppError(400, "INVALID_MULTIPART", "上传请求必须使用 multipart/form-data。");
  }

  const uploadPath = path.join(jobDirectory, JOB_FILES.upload);
  let uploadPromise: Promise<void> | undefined;
  let originalName = "input.webp";
  let bytes = 0;
  let fileSeen = false;
  let deferredError: AppError | undefined;

  parser.on("file", (fieldName, stream, info) => {
    if (fieldName !== "file" || fileSeen) {
      deferredError = new AppError(400, "INVALID_UPLOAD", "只能上传一个 file 字段。");
      stream.resume();
      return;
    }

    fileSeen = true;
    originalName = safeOriginalName(info.filename);
    stream.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
    });
    stream.on("limit", () => {
      deferredError = new AppError(413, "FILE_TOO_LARGE", "文件超过 50 MB 上传限制。");
    });

    uploadPromise = pipeline(
      stream,
      createWriteStream(uploadPath, { flags: "wx", mode: 0o600 }),
    );
  });

  parser.on("filesLimit", () => {
    deferredError = new AppError(400, "TOO_MANY_FILES", "每次只能上传一个文件。");
  });
  parser.on("fieldsLimit", () => {
    deferredError = new AppError(400, "UNEXPECTED_FIELD", "上传请求包含不支持的字段。");
  });
  parser.on("partsLimit", () => {
    deferredError = new AppError(400, "TOO_MANY_PARTS", "上传请求包含过多内容。");
  });

  const parserClosed = new Promise<void>((resolve, reject) => {
    parser.once("close", resolve);
    parser.once("error", reject);
  });

  const nodeStream = Readable.fromWeb(
    request.body as import("node:stream/web").ReadableStream,
  );
  nodeStream.once("error", (error) => {
    if (!parser.destroyed) parser.destroy(error);
  });
  let requestBytes = 0;
  nodeStream.on("data", (chunk: Buffer) => {
    requestBytes += chunk.length;
    if (requestBytes > MAX_MULTIPART_BYTES && !deferredError) {
      deferredError = new AppError(413, "REQUEST_TOO_LARGE", "上传请求体超过允许大小。");
      parser.destroy(deferredError);
      nodeStream.destroy(deferredError);
    }
  });
  nodeStream.pipe(parser);

  try {
    await parserClosed;
    if (uploadPromise) await uploadPromise;
  } catch (error) {
    if (deferredError) throw deferredError;
    if (error instanceof AppError) throw error;
    throw new AppError(400, "UPLOAD_FAILED", "上传数据不完整或格式无效。");
  }

  if (deferredError) throw deferredError;
  if (!fileSeen || !uploadPromise || bytes === 0) {
    throw new AppError(400, "MISSING_FILE", "没有上传 WebP 文件。");
  }

  return { path: uploadPath, originalName, bytes };
}
