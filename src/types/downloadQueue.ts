export type QueueStatus = "queued" | "downloading" | "done" | "failed";

export type CCQueueItem = {
  key: string;
  recordingId: string;
  kind: "recording" | "transcript";
  url: string;
  filename: string;
  status: QueueStatus;
  error?: string;
  attempts?: number;          // NEW
  lastStatusCode?: number;    // NEW (optional but helpful)
};
