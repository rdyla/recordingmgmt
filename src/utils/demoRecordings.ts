import type { Recording } from "../types";

/** Generate ~200 fake phone recordings for demo mode, constrained to [from,to] if provided */
export function generateDemoRecordings(from?: string, to?: string): Recording[] {
  const owners = [
    { name: "Alex Parker", ext: 101 },
    { name: "Jamie Lee", ext: 102 },
    { name: "Morgan Smith", ext: 103 },
    { name: "Taylor Johnson", ext: 104 },
    { name: "Chris Walker", ext: 105 },
    { name: "Jordan Davis", ext: 106 },
    { name: "Riley Thompson", ext: 107 },
    { name: "Casey Martinez", ext: 108 },
    { name: "Drew Allen", ext: 109 },
    { name: "Sam Nguyen", ext: 110 },
    { name: "Avery Patel", ext: 111 },
    { name: "Logan Rivera", ext: 112 },
    { name: "Quinn Brooks", ext: 113 },
    { name: "Harper Green", ext: 114 },
    { name: "Reese Carter", ext: 115 },
    { name: "Devon Flores", ext: 116 },
    { name: "Skyler Reed", ext: 117 },
    { name: "Rowan Young", ext: 118 },
    { name: "Kendall King", ext: 119 },
    { name: "Parker Lewis", ext: 120 },
  ];

  const sites = [
    { id: "site-hq", name: "HQ – Irvine" },
    { id: "site-sj", name: "San Jose" },
    { id: "site-chi", name: "Chicago" },
    { id: "site-phx", name: "Phoenix" },
  ];

  const randomInt = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

  const randomPhone = () =>
    `555${randomInt(1000000, 9999999).toString().padStart(7, "0")}`;

  const directions: Array<"inbound" | "outbound"> = ["inbound", "outbound"];
  const types = ["Automatic", "On-demand"] as const;

  const now = Date.now();

  // Determine time range to generate within
  let startMs: number | null = null;
  let endMs: number | null = null;

  if (from && to) {
    const fromDate = new Date(from + "T00:00:00");
    const toDate = new Date(to + "T23:59:59");
    if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime())) {
      startMs = Math.min(fromDate.getTime(), toDate.getTime());
      endMs = Math.max(fromDate.getTime(), toDate.getTime());
    }
  }

  // Fallback: last 14 days
  if (startMs == null || endMs == null || startMs === endMs) {
    endMs = now;
    startMs = now - 14 * 24 * 60 * 60 * 1000;
  }

  const range = endMs - startMs || 1;

  const records: Recording[] = [];

  for (let i = 0; i < 200; i++) {
    const owner = owners[i % owners.length];
    const site = sites[i % sites.length];
    const direction = directions[i % directions.length];

    const offsetMs = Math.floor(Math.random() * range);
    const start = new Date(startMs + offsetMs);
    const duration = randomInt(30, 1200); // 30s–20m

    const callerName = direction === "inbound" ? "Customer" : owner.name;
    const calleeName = direction === "inbound" ? owner.name : "Customer";

    const callerNumber =
      direction === "inbound" ? randomPhone() : `+1${owner.ext}00`;
    const calleeNumber =
      direction === "inbound" ? `+1${owner.ext}00` : randomPhone();

    records.push({
      id: `demo-${i + 1}`,
      caller_number: callerNumber,
      caller_number_type: 1,
      caller_name: callerName,
      callee_number: calleeNumber,
      callee_number_type: 1,
      callee_name: calleeName,
      direction,
      duration,
      date_time: start.toISOString(),
      recording_type: types[i % types.length],
      owner: {
        type: "user",
        id: `demo-user-${owner.ext}`,
        name: owner.name,
        extension_number: owner.ext,
      },
      site,
      source: "phone",
      file_size: undefined, // could randomize if you want fake sizes
    });
  }

  // sort newest first
  records.sort(
    (a, b) =>
      new Date(b.date_time).getTime() - new Date(a.date_time).getTime()
  );

  return records;
}
