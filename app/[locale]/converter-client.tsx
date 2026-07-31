"use client";

/* eslint-disable @next/next/no-img-element -- Native previews avoid re-encoding user uploads through Next Image. */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { MessageKey, Messages } from "@/messages/zh";
import type {
  Adaptation,
  AnalyzeResponse,
  ContentMode,
  ConvertResponse,
  ErrorResponse,
  QualityClassification,
  TransparencyMode,
} from "@/lib/types";

type Phase = "idle" | "analyzing" | "ready" | "converting" | "done";

const qualityLabelKeys = {
  pixel_exact: "qualityPixelExact",
  high_fidelity: "qualityHighFidelity",
  acceptable: "qualityAcceptable",
  limited: "qualityLimited",
} as const satisfies Record<QualityClassification, MessageKey>;

const adaptationLabelKeys = {
  partial_alpha_thresholded: "adaptationPartialAlphaThresholded",
  partial_alpha_flattened: "adaptationPartialAlphaFlattened",
  binary_transparency_flattened: "adaptationBinaryTransparencyFlattened",
  timing_quantized: "adaptationTimingQuantized",
  icc_normalized_to_srgb: "adaptationIccNormalized",
} as const satisfies Record<Adaptation, MessageKey>;

const warningMessageKeys = {
  PARTIAL_ALPHA: "warningPartialAlpha",
  TIMING_QUANTIZATION: "warningTimingQuantization",
  PALETTE_QUANTIZATION: "warningPaletteQuantization",
  ICC_NORMALIZATION: "warningIccNormalization",
} as const satisfies Record<string, MessageKey>;

const errorMessageKeys = {
  INVALID_CONTENT_LENGTH: "errorInvalidContentLength",
  REQUEST_TOO_LARGE: "errorRequestTooLarge",
  WIDTH_LIMIT: "errorWidthLimit",
  HEIGHT_LIMIT: "errorHeightLimit",
  FRAME_LIMIT: "errorFrameLimit",
  PIXEL_LIMIT: "errorPixelLimit",
  EMPTY_FILE: "errorEmptyFile",
  FILE_TOO_LARGE: "errorFileTooLarge",
  INVALID_IMAGE: "errorInvalidImage",
  NOT_WEBP: "errorNotWebp",
  MISSING_DIMENSIONS: "errorMissingDimensions",
  INVALID_ANIMATION: "errorInvalidAnimation",
  INVALID_TIMING: "errorInvalidTiming",
  DURATION_LIMIT: "errorDurationLimit",
  DECODE_FAILED: "errorDecodeFailed",
  FRAME_SIZE_MISMATCH: "errorFrameSizeMismatch",
  INVALID_BACKGROUND: "errorInvalidBackground",
  MISSING_BODY: "errorMissingBody",
  INVALID_MULTIPART: "errorInvalidMultipart",
  INVALID_UPLOAD: "errorInvalidUpload",
  TOO_MANY_FILES: "errorTooManyFiles",
  UNEXPECTED_FIELD: "errorUnexpectedField",
  TOO_MANY_PARTS: "errorTooManyParts",
  UPLOAD_FAILED: "errorUploadFailed",
  MISSING_FILE: "errorMissingFile",
  INVALID_JOB_ID: "errorInvalidJobId",
  JOB_CREATE_FAILED: "errorJobCreateFailed",
  JOB_NOT_FOUND: "errorJobNotFound",
  JOB_EXPIRED: "errorJobExpired",
  ARTIFACT_NOT_FOUND: "errorArtifactNotFound",
  JOB_ALREADY_QUEUED: "errorJobAlreadyQueued",
  CONVERSION_QUEUE_FULL: "errorQueueFull",
  QUALITY_SIZE_MISMATCH: "errorQualitySizeMismatch",
  OUTPUT_DECODE_FAILED: "errorOutputDecodeFailed",
  OUTPUT_SIZE_CHANGED: "errorOutputSizeChanged",
  INVALID_JSON: "errorInvalidJson",
  INVALID_OPTIONS: "errorInvalidOptions",
  CONVERSION_FAILED: "errorConversionFailed",
  INTERNAL_ERROR: "errorInternal",
} as const satisfies Record<string, MessageKey>;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatLoop(loop: number, messages: Messages): string {
  return loop === 0 ? messages.loopInfinite : `${loop} ${messages.loopTimes}`;
}

async function responseError(response: Response, messages: Messages): Promise<string> {
  try {
    const body = (await response.json()) as ErrorResponse;
    const key = errorMessageKeys[body.error.code as keyof typeof errorMessageKeys];
    return key ? messages[key] : body.error.message;
  } catch {
    return `${messages.requestFailed} (HTTP ${response.status})`;
  }
}

interface ConverterClientProps {
  locale: Locale;
  messages: Messages;
}

export default function ConverterClient({ locale, messages }: ConverterClientProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestGeneration = useRef(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [result, setResult] = useState<ConvertResponse | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transparencyMode, setTransparencyMode] =
    useState<TransparencyMode>("flatten");
  const [background, setBackground] = useState("#FFFFFF");
  const [alphaThreshold, setAlphaThreshold] = useState(128);
  const [contentMode, setContentMode] = useState<ContentMode>("auto");

  const sourcePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (sourcePreview) URL.revokeObjectURL(sourcePreview);
    };
  }, [sourcePreview]);

  function resetForFile(selected: File) {
    requestGeneration.current += 1;
    setFile(selected);
    setAnalysis(null);
    setResult(null);
    setPreviewVersion(0);
    setError(null);
    setPhase("idle");
  }

  async function analyze() {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".webp")) {
      setError(messages.invalidExtension);
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError(messages.fileTooLarge);
      return;
    }

    setPhase("analyzing");
    setError(null);
    const generation = requestGeneration.current;
    const form = new FormData();
    form.append("file", file);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Accept-Language": locale },
        body: form,
      });
      if (!response.ok) throw new Error(await responseError(response, messages));
      const body = (await response.json()) as AnalyzeResponse;
      if (requestGeneration.current !== generation) return;
      setAnalysis(body);
      setTransparencyMode(body.recommendedOptions.transparencyMode);
      setBackground(body.recommendedOptions.background);
      setAlphaThreshold(body.recommendedOptions.alphaThreshold);
      setContentMode("auto");
      setPhase("ready");
    } catch (caught) {
      if (requestGeneration.current !== generation) return;
      setError(caught instanceof Error ? caught.message : messages.analyzeFailed);
      setPhase("idle");
    }
  }

  async function convert() {
    if (!analysis) return;
    setPhase("converting");
    setError(null);
    setResult(null);
    const generation = requestGeneration.current;
    const convertingJobId = analysis.jobId;

    try {
      const response = await fetch("/api/convert", {
        method: "POST",
        headers: {
          "Accept-Language": locale,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobId: analysis.jobId,
          transparencyMode,
          background,
          alphaThreshold,
          contentMode,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, messages));
      if (
        requestGeneration.current !== generation ||
        analysis.jobId !== convertingJobId
      ) return;
      setResult((await response.json()) as ConvertResponse);
      setPreviewVersion((version) => version + 1);
      setPhase("done");
    } catch (caught) {
      if (requestGeneration.current !== generation) return;
      setError(caught instanceof Error ? caught.message : messages.convertFailed);
      setPhase("ready");
    }
  }

  const busy = phase === "analyzing" || phase === "converting";
  const outputPreview = result
    ? `${result.outputUrl}${result.outputUrl.includes("?") ? "&" : "?"}preview=${previewVersion}`
    : null;
  const transparencyLabels = {
    none: messages.alphaNone,
    binary: messages.alphaBinary,
    partial: messages.alphaPartial,
  };

  return (
    <main>
      <header className="hero">
        <nav className="language-switcher" aria-label={messages.languageSwitcher}>
          <Link href="/en" hrefLang="en" aria-current={locale === "en" ? "page" : undefined}>EN</Link>
          <Link href="/zh" hrefLang="zh-CN" aria-current={locale === "zh" ? "page" : undefined}>中文</Link>
        </nav>
        <div className="eyebrow"><span /> INTERNAL IMAGE TOOL</div>
        <h1>WebP <em>→</em> GIF</h1>
        <p>{messages.heroDescription}</p>
        <div className="promise-row" aria-label={messages.featuresAria}>
          <span>{messages.featureStaticAnimated}</span><span>{messages.featureTransparency}</span><span>{messages.featureQuality}</span>
        </div>
      </header>

      <section className="workspace" aria-label={messages.workspaceAria}>
        <nav className="steps" aria-label={messages.stepsAria}>
          {[
            ["01", messages.stepUpload],
            ["02", messages.stepAnalyze],
            ["03", messages.stepSettings],
            ["04", messages.stepVerify],
          ].map(([number, label], index) => {
            const reached =
              index === 0 ||
              (index === 1 && phase !== "idle") ||
              (index === 2 && ["ready", "converting", "done"].includes(phase)) ||
              (index === 3 && phase === "done");
            return <div className={reached ? "step active" : "step"} key={number}><b>{number}</b>{label}</div>;
          })}
        </nav>

        <div className="panel upload-panel">
          <div
            className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (busy) return;
              const selected = event.dataTransfer.files[0];
              if (selected) resetForFile(selected);
            }}
            onClick={() => !busy && inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && !busy) {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".webp,image/webp"
              hidden
              onClick={(event) => {
                event.currentTarget.value = "";
              }}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) resetForFile(selected);
              }}
            />
            <div className="file-glyph">{file ? "W" : "+"}</div>
            {file ? (
              <>
                <strong>{file.name}</strong>
                <span>{formatBytes(file.size)} · {messages.fileReselect}</span>
              </>
            ) : (
              <>
                <strong>{messages.dropTitle}</strong>
                <span>{messages.dropHint}</span>
              </>
            )}
          </div>
          <button className="primary" disabled={!file || busy} onClick={analyze}>
            {phase === "analyzing" ? <><i className="spinner" /> {messages.analyzing}</> : messages.analyzeFile}
          </button>
        </div>

        {error && <div className="error-banner" role="alert"><b>{messages.errorTitle}</b><span>{error}</span></div>}

        {analysis && (
          <>
            <section className="panel analysis-panel">
              <div className="section-heading">
                <div><span>{messages.analysisKicker}</span><h2>{messages.analysisTitle}</h2></div>
                <div className={`exact-pill ${analysis.compatibility.decodedPixelExactPossible ? "yes" : "no"}`}>
                  {analysis.compatibility.decodedPixelExactPossible ? messages.exactPossible : messages.adaptationRequired}
                </div>
              </div>
              <div className="metrics-grid">
                <Metric label={messages.metricSize} value={`${analysis.source.width} × ${analysis.source.height}`} />
                <Metric label={messages.metricFrames} value={String(analysis.source.frames)} />
                <Metric label={messages.metricDuration} value={`${(analysis.source.durationMs / 1000).toFixed(2)} s`} />
                <Metric label={messages.metricLoop} value={formatLoop(analysis.source.loop, messages)} />
                <Metric label={messages.metricTransparency} value={transparencyLabels[analysis.compatibility.alphaMode]} />
                <Metric label={messages.metricColors} value={analysis.compatibility.paletteCompatible ? "≤ 256" : "> 256"} />
              </div>
              {analysis.warnings.length > 0 ? (
                <div className="warning-list">
                  {analysis.warnings.map((warning) => {
                    const key = warningMessageKeys[warning.code as keyof typeof warningMessageKeys];
                    return <div key={warning.code}><span>!</span><p><b>{warning.code.replaceAll("_", " ")}</b>{key ? messages[key] : warning.message}</p></div>;
                  })}
                </div>
              ) : <div className="clean-note">{messages.noWarnings}</div>}
            </section>

            <section className="panel settings-panel">
              <div className="section-heading"><div><span>{messages.settingsKicker}</span><h2>{messages.settingsTitle}</h2></div></div>
              <div className="setting-columns">
                <fieldset>
                  <legend>{messages.transparencyHandling}</legend>
                  <OptionCard active={transparencyMode === "preserve"} onClick={() => setTransparencyMode("preserve")} title={messages.preserveTitle} description={messages.preserveDescription} />
                  {transparencyMode === "preserve" && (
                    <label className="range-row">{messages.alphaThreshold} <input type="range" min="0" max="255" value={alphaThreshold} onChange={(event) => setAlphaThreshold(Number(event.target.value))} /><output>{alphaThreshold}</output></label>
                  )}
                  <OptionCard active={transparencyMode === "flatten"} onClick={() => setTransparencyMode("flatten")} title={messages.flattenTitle} description={messages.flattenDescription} />
                  {transparencyMode === "flatten" && (
                    <label className="colour-row">{messages.backgroundColor} <input type="color" value={background} onChange={(event) => setBackground(event.target.value.toUpperCase())} /><input aria-label={messages.backgroundHexAria} value={background} onChange={(event) => setBackground(event.target.value.toUpperCase())} /></label>
                  )}
                </fieldset>
                <fieldset>
                  <legend>{messages.contentType}</legend>
                  <OptionCard active={contentMode === "auto"} onClick={() => setContentMode("auto")} title={messages.autoTitle} description={messages.autoDescription} badge={messages.recommended} />
                  <OptionCard active={contentMode === "photo"} onClick={() => setContentMode("photo")} title={messages.photoTitle} description={messages.photoDescription} />
                  <OptionCard active={contentMode === "line-art"} onClick={() => setContentMode("line-art")} title={messages.lineArtTitle} description={messages.lineArtDescription} />
                </fieldset>
              </div>
              <button className="primary convert-button" disabled={busy || !/^#[0-9A-F]{6}$/.test(background)} onClick={convert}>
                {phase === "converting" ? <><i className="spinner" /> {messages.converting}</> : messages.convertAndReport}
              </button>
              {phase === "converting" && <p className="queue-note">{messages.queueNote}</p>}
            </section>
          </>
        )}

        {result && outputPreview && sourcePreview && (
          <section className="panel report-panel">
            <div className="report-hero">
              <div><span>{messages.reportKicker}</span><p>{messages.qualityGrade}</p><h2>{messages[qualityLabelKeys[result.quality.classification]]}</h2></div>
              <div className="score-ring"><strong>{result.quality.psnrDb === null ? "∞" : result.quality.psnrDb.toFixed(1)}</strong><span>PSNR dB</span></div>
            </div>
            <div className="report-metrics">
              <Metric label={messages.metricMeanAbsoluteError} value={result.quality.meanAbsoluteError.toFixed(3)} />
              <Metric label={messages.metricMaximumChannelError} value={String(result.quality.maximumChannelError)} />
              <Metric label={messages.metricChangedPixels} value={`${(result.quality.changedPixelRatio * 100).toFixed(2)}%`} />
              <Metric label={messages.metricDurationError} value={`${result.quality.durationErrorMs} ms`} />
              <Metric label={messages.metricFrameCount} value={result.quality.frameCountPreserved ? messages.match : messages.mismatch} />
              <Metric label={messages.metricLoopCount} value={result.quality.loopPreserved ? messages.match : messages.mismatch} />
            </div>
            {result.adaptations.length > 0 && (
              <div className="adaptations"><b>{messages.adaptationsHeading}</b>{result.adaptations.map((item) => <span key={item}>{messages[adaptationLabelKeys[item]]}</span>)}</div>
            )}
            <div className="preview-grid">
              <figure><figcaption>{messages.sourcePreview}</figcaption><div><img src={sourcePreview} alt={messages.sourcePreviewAlt} /></div></figure>
              <figure><figcaption>{messages.outputPreview}</figcaption><div><img src={outputPreview} alt={messages.outputPreviewAlt} /></div></figure>
            </div>
            <div className="download-row">
              <a className="primary" href={result.outputUrl} download>{messages.downloadGif} <small>{formatBytes(result.outputSize)}</small></a>
              <a className="secondary" href={result.reportUrl} download>{messages.downloadReport}</a>
            </div>
          </section>
        )}
      </section>

      <footer><span>{messages.footerArchitecture}</span><span>{messages.footerCleanup}</span></footer>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function OptionCard({ active, onClick, title, description, badge }: { active: boolean; onClick: () => void; title: string; description: string; badge?: string }) {
  return <button type="button" aria-pressed={active} className={`option-card ${active ? "selected" : ""}`} onClick={onClick}><i /> <span><b>{title}{badge && <em>{badge}</em>}</b><small>{description}</small></span></button>;
}
