import { api } from "./api";
import { flush, outbox, queued, type Job } from "./outbox";

const send = async (job: any) => {
  switch (job.kind) {
    case "start":  return void (await api.start(job.stageId, job.clientEventId, job.occurredAt));
    case "resume": return void (await api.resume(job.stageId, job.clientEventId, job.occurredAt));
    case "finish": return void (await api.finish(job.stageId, job.clientEventId, job.occurredAt));
    case "pause":  return void (await api.pause(job.stageId, job.reason, job.note, job.clientEventId, job.occurredAt));
    case "photo":  return void (await api.uploadPhoto(job.stageId, job.photoKind, job.blob, job.w, job.h, job.clientEventId, job.occurredAt));
  }
};

export const sync = () => flush(send);

/** Queue, then try immediately. The UI never waits for either. */
export async function enqueue(job: Job) {
  await outbox.add(job);
  await queued();
  void sync();
}

export function startSyncLoop() {
  void sync();
  window.addEventListener("online", () => void sync());
  window.addEventListener("offline", () => void queued());
  setInterval(() => void sync(), 15_000);
}

export const newId = () => crypto.randomUUID();
