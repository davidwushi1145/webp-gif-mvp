import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_JSON_BYTES } from "@/lib/config";
import { convertWebpToGif } from "@/lib/convert-webp";
import { withConversionLock } from "@/lib/conversion-lock";
import { AppError, assertContentLength, errorResponse } from "@/lib/errors";
import { assertValidJobId, loadJobDocument } from "@/lib/job-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const convertSchema = z
  .object({
    jobId: z.string(),
    transparencyMode: z.enum(["preserve", "flatten"]),
    background: z.string().regex(/^#[0-9a-f]{6}$/i),
    alphaThreshold: z.number().int().min(0).max(255),
    contentMode: z.enum(["auto", "photo", "line-art"]),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertContentLength(request, MAX_JSON_BYTES);
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      throw new AppError(400, "INVALID_JSON", "转换参数不是有效的 JSON。");
    }

    const parsed = convertSchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError(400, "INVALID_OPTIONS", "转换参数无效。");
    }
    assertValidJobId(parsed.data.jobId);

    const result = await withConversionLock(parsed.data.jobId, async () => {
      const document = await loadJobDocument(parsed.data.jobId);
      return convertWebpToGif(document, parsed.data);
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
