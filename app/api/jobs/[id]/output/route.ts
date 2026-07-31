import { open } from "node:fs/promises";
import { Readable } from "node:stream";
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
  request: Request,
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
    let outputHandle;
    try {
      outputHandle = await open(/*turbopackIgnore: true*/ outputPath, "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AppError(404, "ARTIFACT_NOT_FOUND", "转换结果尚不存在或已过期。");
      }
      throw error;
    }
    const details = await outputHandle.stat();
    const nodeStream = outputHandle.createReadStream({ autoClose: true });
    const body = Readable.toWeb(nodeStream) as unknown as BodyInit;

    return new Response(body, {
      headers: {
        "Content-Type": "image/gif",
        "Content-Length": String(details.size),
        "Content-Disposition": new URL(request.url).searchParams.has("preview")
          ? 'inline; filename="converted.gif"'
          : 'attachment; filename="converted.gif"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
