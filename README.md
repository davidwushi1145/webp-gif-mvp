# WebP to GIF High-Fidelity Converter

[![Docker image](https://github.com/davidwushi1145/webp-gif-mvp/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/davidwushi1145/webp-gif-mvp/actions/workflows/docker-publish.yml)

A lightweight, self-hosted web application for analyzing and converting static or animated WebP images to GIF. The browser UI, API, Sharp/libvips conversion pipeline, quality checks, and temporary job storage all run in one Next.js process and ship in a single Docker image.

The converter is designed for small, trusted deployments where preserving animation timing and clean transparent edges matters more than raw throughput.

## Highlights

- Converts both static and animated WebP files
- Inspects dimensions, frame count, duration, loop behavior, alpha, color count, and ICC metadata before conversion
- Preserves binary transparency or flattens alpha onto a chosen background color
- Provides three content modes:
  - **Auto** protects transparent outlines and selects dithering only when it is useful
  - **Photo / Gradient** uses dithering to reduce visible color banding
  - **Icon / Text** avoids noisy edge dithering and prioritizes crisp silhouettes
- Preserves frame count, loop count, and timing whenever GIF can represent them
- Calculates MAE, RMSE, PSNR, maximum channel error, and changed-pixel ratio
- Exports the converted GIF and a machine-readable JSON quality report
- Includes English and Simplified Chinese interfaces with locale-specific routes
- Streams uploads and analyzes frames incrementally to reduce memory peaks
- Uses isolated UUID job directories, bounded conversion concurrency, and automatic expiration
- Runs as a non-root user in a multi-stage Docker image

## Why conversion cannot always be lossless

WebP and GIF have different capabilities. GIF supports at most 256 palette entries per frame, only one fully transparent palette entry, and frame delays in 10 ms increments. A source that uses partial alpha, more than 256 colors, ICC color management, or finer timing must therefore be adapted.

The application reports these constraints before conversion and records every applied adaptation in the downloadable quality report.

## Quick start with Docker Compose

Requirements:

- Docker Engine with Compose support

Build and start the application:

```bash
docker compose up --build -d
```

Open [http://localhost:3000](http://localhost:3000).

By default, Compose publishes the application only on `127.0.0.1:3000`. To use another host port, change the mapping in `compose.yaml`:

```yaml
ports:
  - "127.0.0.1:3001:3000"
```

For access from another machine, place the application behind an authenticated reverse proxy or change the host address deliberately:

```yaml
ports:
  - "3001:3000"
```

> [!WARNING]
> The application does not include user authentication. Do not expose it directly to the public internet without an authentication and rate-limiting layer.

## Prebuilt container image

A public multi-platform image for `linux/amd64` and `linux/arm64` is published to GitHub Container Registry on every push to `main`:

```bash
docker pull ghcr.io/davidwushi1145/webp-gif-mvp:latest
```

Run the published image:

```bash
docker run -d \
  --name webp-gif-mvp \
  --restart unless-stopped \
  --memory=2g \
  --cpus=2 \
  -p 127.0.0.1:3000:3000 \
  -v webp-gif-data:/app/data \
  ghcr.io/davidwushi1145/webp-gif-mvp:latest
```

Available tags include:

- `latest` for the current `main` branch
- `sha-<commit>` for an immutable source revision
- `<major>.<minor>.<patch>` and `<major>.<minor>` when a `v<major>.<minor>.<patch>` Git tag is pushed

The package inherits this repository's public visibility, so pulling it does not require a GitHub login.

## Run with Docker

Build the image:

```bash
docker build -t webp-gif-mvp:latest .
```

Run it with a persistent job volume and conservative resource limits:

```bash
docker run -d \
  --name webp-gif-mvp \
  --restart unless-stopped \
  --memory=2g \
  --cpus=2 \
  -p 127.0.0.1:3000:3000 \
  -v webp-gif-data:/app/data \
  webp-gif-mvp:latest
```

The production image uses Next.js standalone output. A single Node.js process serves both the frontend and all API routes. The supplied runtime configuration limits the Node.js heap to 512 MiB, Sharp concurrency to one thread per image, and the Sharp memory cache to 32 MiB.

## Local development

Requirements:

- Node.js 20.9 or newer
- npm

Install dependencies and start the development server:

```bash
npm ci
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Internationalization

The application provides two locale routes:

- `/en` — English
- `/zh` — Simplified Chinese

Requests to `/` are redirected using the browser's `Accept-Language` header, with English as the fallback. Users can switch languages from the control in the page header.

Internationalization is implemented with native App Router primitives instead of an additional client-side library:

- `[locale]` provides route-level locale separation.
- Dictionaries are loaded dynamically in a React Server Component, so only the selected messages are serialized to the client.
- The English dictionary uses TypeScript `satisfies` against the complete Chinese key set, causing missing or extra translation keys to fail type checking.
- Locale-specific metadata and `hreflang` alternates are generated on the server.
- Known API error and compatibility-warning codes are translated in the client instead of exposing server fallback text.

Translation dictionaries live in `messages/en.ts` and `messages/zh.ts`. Locale routing and server-side dictionary loading live in `lib/i18n.ts`.

Run all project checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## How it works

1. The browser streams a `.webp` file to `POST /api/analyze`.
2. The server validates the file signature and configured size limits, then analyzes every frame.
3. The UI displays compatibility warnings and recommends transparency settings.
4. `POST /api/convert` performs a bounded, serialized conversion using the selected content mode.
5. The server decodes the generated GIF and compares it with the normalized source pixels.
6. The GIF and JSON report are made available through job-specific download endpoints.

The **Auto** content mode treats transparent artwork conservatively. It disables color dithering around transparent silhouettes to prevent rough halos and speckled edges. For opaque images with more colors than GIF can represent, it enables dithering to reduce gradient banding.

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/analyze` | Accept a multipart WebP upload and return source analysis plus recommended options |
| `POST` | `/api/convert` | Convert an analyzed job using JSON options |
| `GET` | `/api/jobs/:id/output` | Download the generated GIF |
| `GET` | `/api/jobs/:id/report` | Download the JSON quality report |

Example conversion request:

```json
{
  "jobId": "c57446c7-5082-4a25-a133-5cfb425bfe73",
  "transparencyMode": "preserve",
  "background": "#FFFFFF",
  "alphaThreshold": 128,
  "contentMode": "auto"
}
```

## Configuration

| Environment variable | Default | Description |
| --- | ---: | --- |
| `JOB_ROOT` | `data/jobs` | Directory used for temporary job files |
| `MAX_UPLOAD_BYTES` | `52428800` | Maximum WebP upload size |
| `MAX_IMAGE_WIDTH` | `4096` | Maximum image width |
| `MAX_IMAGE_HEIGHT` | `4096` | Maximum height of one frame |
| `MAX_IMAGE_FRAMES` | `600` | Maximum frame count |
| `MAX_DURATION_MS` | `120000` | Maximum total animation duration |
| `MAX_TOTAL_PIXELS` | `50000000` | Maximum `width × frame height × frame count` |
| `JOB_TTL_MS` | `86400000` | Job lifetime before expiration |
| `MAX_PENDING_CONVERSIONS` | `3` | Maximum active and queued conversions |
| `SHARP_CONCURRENCY` | `1` | libvips threads used per image |
| `SHARP_CACHE_MEMORY_MB` | `32` | Sharp memory-cache limit in MiB |

Fifty million decoded pixels require roughly 191 MiB for one RGBA buffer. GIF quantization, libvips operations, source frames, and output buffers require additional native memory. The Compose configuration therefore uses a 2 GiB container limit. If you lower the limit to 1 GiB or less, also reduce `MAX_TOTAL_PIXELS` and validate the configuration with representative production files.

## Job storage and cleanup

Development jobs are stored under `data/jobs/<uuid>/`. Docker Compose stores the same directory in the `webp-gif-data` volume. Each completed job contains:

```text
input.webp
analysis.json
output.gif
report.json
```

Jobs expire after 24 hours by default. Cleanup runs opportunistically when later files are analyzed, and an expired job is also removed when a client attempts to read it. This storage model is intentionally local: there is no database, object storage, distributed queue, or multi-instance coordination.

## Resource profile

The runtime is configured for low idle memory and serial image conversion. In one Docker smoke test using a 125 × 125, six-frame transparent WebP, the idle container used approximately 49 MiB after conversion. Actual peak memory depends on decoded pixel count, frame count, quantization complexity, and concurrent requests; size your container using representative inputs rather than the idle figure.

## Project structure

```text
app/                 Next.js UI and API routes
lib/                 WebP analysis, GIF conversion, validation, and storage
messages/            Type-safe English and Chinese dictionaries
tests/               Core conversion and validation tests
data/jobs/           Local temporary job storage
Dockerfile           Multi-stage production image
compose.yaml         Single-container deployment
```

## Deployment notes

- The container runs as a dedicated non-root user.
- Compose drops Linux capabilities and enables `no-new-privileges`.
- Uploaded content is validated by file signature as well as filename.
- Upload, dimension, frame, duration, total-pixel, queue, and JSON-body limits are enforced server-side.
- This project is optimized for one small instance. Multiple replicas require shared storage and a distributed conversion lock.
