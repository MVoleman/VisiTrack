export type CameraErrorKind = "denied" | "not-found" | "in-use" | "insecure" | "unsupported" | "unknown";

export class CameraError extends Error {
  constructor(
    public kind: CameraErrorKind,
    cause?: unknown,
  ) {
    super(`Camera error: ${kind}`, { cause });
  }
}

/**
 * Opens the front-facing camera. Asks for a modest resolution: enough for
 * reliable QR decoding at arm's length, cheap to process on a Chromebook.
 */
export async function openCamera(): Promise<MediaStream> {
  if (typeof window !== "undefined" && !window.isSecureContext) throw new CameraError("insecure");
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError("unsupported");

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") throw new CameraError("denied", error);
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new CameraError("not-found", error);
    if (name === "NotReadableError" || name === "AbortError") throw new CameraError("in-use", error);
    throw new CameraError("unknown", error);
  }
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Resolves once the video element has real frame dimensions. */
export function waitForVideo(video: HTMLVideoElement) {
  return new Promise<void>((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) return resolve();
    video.addEventListener("loadeddata", () => resolve(), { once: true });
  });
}
