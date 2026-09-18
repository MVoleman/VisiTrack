import { BarcodeDetector as ZXingBarcodeDetector, prepareZXingModule, ZXING_WASM_VERSION } from "barcode-detector/ponyfill";

/** Badge tokens are prefixed so unrelated QR codes are ignored without a round trip. */
export const TOKEN_PREFIX = "vt1_";
const TOKEN_PATTERN = /^vt1_[A-Za-z0-9_-]{32}$/;

/** Longest edge of the frame used for decoding and for the snapshot. */
const FRAME_MAX_EDGE = 640;
const SNAPSHOT_QUALITY = 0.72;
/** ~8 decodes per second: responsive, and light on low-end Chromebooks. */
const SCAN_INTERVAL_MS = 125;

export type ScanHit = {
  token: string;
  /** Wall-clock time of the exact video frame the QR code was decoded from. */
  capturedAt: Date;
  /** JPEG of that same frame. */
  snapshot: Promise<Blob | null>;
};

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };

let wasmConfigured = false;

async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: typeof ZXingBarcodeDetector }).BarcodeDetector;
  if (Native) {
    try {
      const formats = await Native.getSupportedFormats();
      if (formats.includes("qr_code")) return new Native({ formats: ["qr_code"] });
    } catch {
      // Fall through to the WebAssembly implementation.
    }
  }

  if (!wasmConfigured) {
    prepareZXingModule({
      overrides: {
        // Served from /public (see scripts/copy-zxing-wasm.mjs) instead of a CDN.
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? `/zxing/zxing_reader-${ZXING_WASM_VERSION}.wasm` : prefix + path,
      },
    });
    wasmConfigured = true;
  }
  return new ZXingBarcodeDetector({ formats: ["qr_code"] });
}

/**
 * Continuously decodes QR codes from a playing <video>. Every decode runs on a
 * canvas copy of one frame; when a badge is found, that very canvas becomes the
 * snapshot, so the photo is guaranteed to show the moment the code was read.
 */
export class QrScanner {
  private detector: Detector | null = null;
  private frame = document.createElement("canvas");
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private busy = false;

  constructor(
    private video: HTMLVideoElement,
    private onHit: (hit: ScanHit) => void,
  ) {}

  /** Downloads/instantiates the decoder ahead of the first scan. */
  async prepare() {
    this.detector ??= await createDetector();
    // Warm up the WebAssembly module with a blank frame.
    this.frame.width = this.frame.height = 16;
    await this.detector.detect(this.frame).catch(() => []);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay: number) {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick() {
    if (!this.running || this.busy) return;
    const { video } = this;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) {
      return this.schedule(SCAN_INTERVAL_MS);
    }

    this.busy = true;
    const started = performance.now();
    try {
      this.detector ??= await createDetector();

      const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.round(video.videoWidth * scale);
      const height = Math.round(video.videoHeight * scale);
      if (this.frame.width !== width || this.frame.height !== height) {
        this.frame.width = width;
        this.frame.height = height;
      }
      const ctx = this.frame.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(video, 0, 0, width, height);
      const capturedAt = new Date();

      const codes = await this.detector.detect(this.frame);
      const token = codes.map((c) => c.rawValue.trim()).find((v) => TOKEN_PATTERN.test(v));

      if (token && this.running) {
        // Freeze this exact frame before the loop can draw the next one.
        const still = document.createElement("canvas");
        still.width = width;
        still.height = height;
        still.getContext("2d")!.drawImage(this.frame, 0, 0);
        const snapshot = new Promise<Blob | null>((resolve) => still.toBlob(resolve, "image/jpeg", SNAPSHOT_QUALITY));
        this.onHit({ token, capturedAt, snapshot });
      }
    } catch (error) {
      console.warn("QR decode failed", error);
    } finally {
      this.busy = false;
      this.schedule(Math.max(0, SCAN_INTERVAL_MS - (performance.now() - started)));
    }
  }
}
