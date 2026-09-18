import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const BUCKET = "snapshots";
/** The database only accepts an upload within 10 minutes of the scan; stop retrying before that. */
const GIVE_UP_AFTER_MS = 9 * 60_000;
const BACKOFF_MS = [1_000, 3_000, 8_000, 15_000, 30_000, 60_000];

type Job = { timeLogId: string; path: string; blob: Blob; createdAt: number; attempt: number };

/**
 * Uploads snapshots in the background so the person at the kiosk never waits
 * for the network. Retries with backoff (flaky school Wi-Fi) and confirms each
 * upload with the database.
 */
export class SnapshotUploader {
  private queue: Job[] = [];
  private running = false;

  constructor(
    private supabase: SupabaseClient<Database>,
    private onStatus?: (pending: number) => void,
  ) {}

  enqueue(timeLogId: string, path: string, blob: Blob) {
    this.queue.push({ timeLogId, path, blob, createdAt: Date.now(), attempt: 0 });
    this.onStatus?.(this.queue.length);
    void this.drain();
  }

  get pending() {
    return this.queue.length;
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue[0];
        const done = await this.attempt(job);
        this.queue.shift();

        if (!done) {
          job.attempt += 1;
          const delay = BACKOFF_MS[Math.min(job.attempt - 1, BACKOFF_MS.length - 1)];
          if (Date.now() + delay - job.createdAt < GIVE_UP_AFTER_MS) {
            setTimeout(() => {
              this.queue.push(job);
              this.onStatus?.(this.queue.length);
              void this.drain();
            }, delay);
          } else {
            console.error("Giving up on snapshot upload", job.timeLogId);
          }
        }
        this.onStatus?.(this.queue.length);
      }
    } finally {
      this.running = false;
    }
  }

  private async attempt(job: Job): Promise<boolean> {
    const { error } = await this.supabase.storage
      .from(BUCKET)
      .upload(job.path, job.blob, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });

    // "Already exists" means an earlier attempt succeeded but its response was lost.
    const alreadyUploaded = error && /exists|duplicate/i.test(error.message);
    if (error && !alreadyUploaded) {
      console.warn("Snapshot upload failed", job.timeLogId, error.message);
      return false;
    }

    const { data, error: confirmError } = await this.supabase.rpc("kiosk_confirm_snapshot", {
      p_time_log_id: job.timeLogId,
    });
    if (confirmError) {
      console.warn("Snapshot confirmation failed", job.timeLogId, confirmError.message);
      return false;
    }
    if (!data) console.warn("Snapshot confirmation returned false (already confirmed?)", job.timeLogId);
    return true;
  }
}
