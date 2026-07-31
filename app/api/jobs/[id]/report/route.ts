import { open } from "node:fs/promises";
import { AppError, errorResponse } from "@/lib/errors";
import {
  JOB_FILES,
  assertArtifactExists,
  getJobFile,
  loadJobDocument,
} from "@/lib/job-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await loadJobDocument(id);
    const outputPath = getJobFile(id, JOB_FILES.output);
    const reportPath = getJobFile(id, JOB_FILES.report);
    await Promise.all([
      assertArtifactExists(outputPath),
      assertArtifactExists(reportPath),
    ]);
    let reportHandle;
    try {
      reportHandle = await open(/*turbopackIgnore: true*/ reportPath, "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AppError(404, "ARTIFACT_NOT_FOUND", "转换结果尚不存在或已过期。");
      }
      throw error;
    }
    let report: Buffer;
    try {
      report = await reportHandle.readFile();
    } finally {
      await reportHandle.close();
    }

    return new Response(new Uint8Array(report), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(report.length),
        "Content-Disposition": 'attachment; filename="quality-report.json"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
