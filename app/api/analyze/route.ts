import { rename } from "node:fs/promises";
import { NextResponse } from "next/server";
import { analyzeWebp } from "@/lib/analyze-webp";
import { IMAGE_LIMITS, MAX_MULTIPART_BYTES } from "@/lib/config";
import { assertContentLength, errorResponse } from "@/lib/errors";
import {
  JOB_FILES,
  cleanupExpiredJobs,
  createJobDirectory,
  getJobFile,
  removeJob,
  writeJsonAtomic,
} from "@/lib/job-storage";
import { streamMultipartUpload } from "@/lib/upload";
import type { AnalyzeResponse, JobDocument } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let jobId: string | undefined;

  try {
    assertContentLength(request, MAX_MULTIPART_BYTES);
    void cleanupExpiredJobs().catch((error) => {
      console.warn("Expired job cleanup failed", error);
    });

    const created = await createJobDirectory();
    jobId = created.jobId;
    const upload = await streamMultipartUpload(request, created.directory);
    const analysis = await analyzeWebp(upload.path, upload.bytes);

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + IMAGE_LIMITS.jobTtlMs);
    const document: JobDocument = {
      version: 1,
      jobId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      originalName: upload.originalName,
      analysis,
    };

    await rename(upload.path, getJobFile(jobId, JOB_FILES.input));
    await writeJsonAtomic(getJobFile(jobId, JOB_FILES.analysis), document);

    const response: AnalyzeResponse = {
      jobId,
      source: {
        width: analysis.width,
        height: analysis.height,
        frames: analysis.frames,
        durationMs: analysis.durationMs,
        loop: analysis.loop,
        fileSize: analysis.fileSize,
      },
      compatibility: {
        alphaMode: analysis.alphaMode,
        timingCompatible: analysis.timingCompatible,
        paletteCompatible: analysis.paletteCompatible,
        maxPaletteEntriesPerFrame: analysis.maxPaletteEntriesPerFrame,
        decodedPixelExactPossible: analysis.decodedPixelExactPossible,
        hasIccProfile: analysis.hasIccProfile,
      },
      warnings: analysis.warnings,
      recommendedOptions: {
        jobId,
        transparencyMode: analysis.alphaMode === "partial" ? "flatten" : "preserve",
        background: "#FFFFFF",
        alphaThreshold: 128,
        contentMode:
          analysis.alphaMode !== "none" || analysis.paletteCompatible
            ? "line-art"
            : "photo",
      },
      expiresAt: document.expiresAt,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (jobId) await removeJob(jobId).catch(() => undefined);
    return errorResponse(error);
  }
}
