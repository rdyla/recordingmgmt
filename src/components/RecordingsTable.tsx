import React, { useEffect, useState } from "react";
import type { OwnerGroup, PageRecord } from "../hooks/useOwnerGroups";
import type { Recording, MeetingAnalyticsStats } from "../types";
import { formatBytes } from "../utils/recordingFormatters";

export type RecordingsTableProps = {
  ownerGroups: OwnerGroup[];
  isGroupCollapsed: (groupKey: string) => boolean;
  toggleGroupCollapse: (groupKey: string) => void;
  isGroupFullySelected: (group: OwnerGroup) => boolean;
  toggleGroupSelection: (group: OwnerGroup, checked: boolean) => void;
  makeRecordKey: (rec: Recording, idx: number) => string;
  toggleRowSelection: (rec: Recording, idx: number) => void;
  selectedKeys: Set<string>;
  selectAllOnPage: (checked: boolean) => void;
  allOnPageSelected: boolean;
  demoMode: boolean;

  // NEW (optional): meeting analytics map
  analyticsByMeetingId?: Record<string, MeetingAnalyticsStats | undefined>;
};

const DownloadIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path
      fill="currentColor"
      d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4.01 4.01a1.2 1.2 0 0 1-1.38.22a1.2 1.2 0 0 1-.22-.22L7.08 11.7a1 1 0 1 1 1.42-1.4L11 12.8V4a1 1 0 0 1 1-1ZM5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z"
    />
  </svg>
);

const RecordingsTable: React.FC<RecordingsTableProps> = ({
  ownerGroups,
  isGroupCollapsed,
  toggleGroupCollapse,
  isGroupFullySelected,
  toggleGroupSelection,
  makeRecordKey,
  toggleRowSelection,
  selectedKeys,
  selectAllOnPage,
  allOnPageSelected,
  demoMode,
  analyticsByMeetingId,
}) => {
  // one open menu at a time (by row key)
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);

  useEffect(() => {
    const onDocClick = () => {
      setOpenMenuKey(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuKey(null);
    };

    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="table-wrapper">
      <table className="rec-table">
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                checked={allOnPageSelected}
                onChange={(e) => selectAllOnPage(e.target.checked)}
              />
            </th>
            <th>Date / Time</th>
            <th>Primary</th>
            <th>Owner / Host</th>

            <th>Files</th>
            <th>Size</th>

            {/* NEW columns (optional, meetings only) */}
            <th>Plays</th>
            <th>Downloads</th>
            <th>Last access</th>

            <th>Auto-delete date</th>
          </tr>
        </thead>

        <tbody>
          {ownerGroups.map((group) => {
            const groupSelected = isGroupFullySelected(group);
            const collapsed = isGroupCollapsed(group.key);

            const dateRangeLabel =
              group.firstDate && group.lastDate
                ? `${group.firstDate.toLocaleDateString()} → ${group.lastDate.toLocaleDateString()}`
                : "—";

            return (
              <React.Fragment key={group.key}>
                {/* Group header row */}
                <tr className="rec-row group-row">
                  <td>
                    <input
                      type="checkbox"
                      checked={groupSelected}
                      onChange={(e) =>
                        toggleGroupSelection(group, e.target.checked)
                      }
                    />
                  </td>
                  <td colSpan={9}>
                    <button
                      type="button"
                      className="group-toggle"
                      onClick={() => toggleGroupCollapse(group.key)}
                    >
                      {collapsed ? "▶" : "▼"}
                    </button>
                    <strong>{group.ownerLabel}</strong>{" "}
                    <span style={{ opacity: 0.8 }}>
                      · {group.sourceLabel} · {group.count} recording
                      {group.count !== 1 ? "s" : ""} · Total size{" "}
                      {formatBytes(group.totalSizeBytes)} · {dateRangeLabel}
                    </span>
                  </td>
                </tr>

                {/* Child rows */}
                {!collapsed &&
                  group.items.map(({ rec, globalIndex }: PageRecord) => {
  const rowKey = makeRecordKey(rec, globalIndex);

  const isMeeting = rec.source === "meetings";
  const isCC = rec.source === "cc";

  const dt = rec.date_time
    ? new Date(rec.date_time)
    : rec.end_time
    ? new Date(rec.end_time)
    : null;

  const dateDisplay = dt
    ? dt.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  // Primary + Owner/Host display:
  // - meetings: topic + host
  // - phone: caller + owner
  // - cc: caller(consumers) + agent(display_name)
  const primary = isMeeting
    ? rec.topic || rec.caller_name || "Meeting"
    : rec.caller_name && rec.caller_number
    ? `${rec.caller_name} (${rec.caller_number})`
    : rec.caller_name || rec.caller_number || "—";

  const ownerDisplay = isMeeting
    ? rec.host_email || rec.owner?.name || "—"
    : isCC
    ? // cc agent
      (rec as any).cc_agent_name ||
      (rec as any).cc_agent_email ||
      rec.owner?.name ||
      "—"
    : // phone owner
    rec.owner?.name && rec.owner?.extension_number
    ? `${rec.owner.name} (${rec.owner.extension_number})`
    : rec.owner?.name || "—";

  const sizeDisplay = formatBytes(rec.file_size);

  // --- analytics (meetings only) ---
  const meetingId = (rec as any).meetingId || "";
  const stats = isMeeting ? analyticsByMeetingId?.[meetingId] : undefined;

  const plays = isMeeting ? stats?.plays : undefined;
  const downloads = isMeeting ? stats?.downloads : undefined;
  const lastAccessDate = isMeeting ? stats?.lastAccessDate ?? "" : "";

  // --- meeting file links (menu) ---
  const files = isMeeting ? rec.recording_files ?? [] : [];
  const fileCount = isMeeting
    ? rec.files_count ?? files.length
    : rec.download_url
    ? 1
    : 0;

  const meetingFileLinks = (() => {
    if (!isMeeting) return [];

    const seenTypes = new Set<string>();
    const out: Array<{ label: string; href: string }> = [];

    for (const f of files) {
      const t = (f.file_type || "FILE").toUpperCase();
      if (!f.download_url || seenTypes.has(t)) continue;
      seenTypes.add(t);

      const safeTopic = (rec.topic || rec.caller_name || "meeting")
        .toLowerCase()
        .replace(/[^a-z0-9_\-]+/g, "_")
        .slice(0, 40);

      const dtPart = f.recording_start
        ? new Date(f.recording_start)
            .toISOString()
            .slice(0, 19)
            .replace(/[:T]/g, "-")
        : rec.date_time
        ? new Date(rec.date_time)
            .toISOString()
            .slice(0, 19)
            .replace(/[:T]/g, "-")
        : "recording";

      const ext =
        (f.file_extension || f.file_type || "").toLowerCase() || "dat";

      const filename = `${safeTopic}_${dtPart}.${ext}`;

      const href = `/api/meeting/recordings/download?url=${encodeURIComponent(
        f.download_url
      )}&filename=${encodeURIComponent(filename)}`;

      out.push({ label: t, href });
    }

    return out;
  })();

  // --- cc links (menu) ---
  const ccLinks: Array<{ label: string; href: string }> = [];
  if (isCC && !demoMode) {
    const recUrl = (rec as any).cc_download_url as string | undefined;
    const txUrl = (rec as any).cc_transcript_url as string | undefined;

    if (recUrl) {
      ccLinks.push({
        label: "RECORDING",
        href: `/api/contact_center/recordings/download?url=${encodeURIComponent(
          recUrl
        )}&filename=${encodeURIComponent(`cc_recording_${rec.id}.mp4`)}`,
      });
    }
    if (txUrl) {
      ccLinks.push({
        label: "TRANSCRIPT",
        href: `/api/contact_center/recordings/download?url=${encodeURIComponent(
          txUrl
        )}&filename=${encodeURIComponent(`cc_transcript_${rec.id}.vtt`)}`,
      });
    }
  }

  // --- files cell (meeting | cc | phone) ---
  let filesCell: React.ReactNode = "—";

  if (isMeeting) {
    filesCell = fileCount ? (
      <div className="files-cell">
        <span className="files-count">
          {fileCount} file{fileCount !== 1 ? "s" : ""}
        </span>

        {meetingFileLinks.length > 0 && !demoMode && (
          <div
            className="download-menu-wrap"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="icon-btn"
              aria-label="Download files"
              title="Download files"
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenuKey((k) => (k === rowKey ? null : rowKey));
              }}
            >
              <DownloadIcon />
            </button>

            {openMenuKey === rowKey && (
              <div
                className="download-menu"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="download-menu-title">Download files</div>
                {meetingFileLinks.map((l) => (
                  <a
                    key={l.label}
                    className="download-menu-item"
                    href={l.href}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    ) : (
      "—"
    );
  } else if (isCC) {
    const count = ccLinks.length;
    filesCell = count ? (
      <div className="files-cell">
        <span className="files-count">
          {count} file{count !== 1 ? "s" : ""}
        </span>

        <div
          className="download-menu-wrap"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="icon-btn"
            aria-label="Download CC files"
            title="Download"
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenuKey((k) => (k === rowKey ? null : rowKey));
            }}
          >
            <DownloadIcon />
          </button>

          {openMenuKey === rowKey && (
            <div className="download-menu" onClick={(e) => e.stopPropagation()}>
              <div className="download-menu-title">Download</div>
              {ccLinks.map((l) => (
                <a key={l.label} className="download-menu-item" href={l.href}>
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    ) : (
      "—"
    );
  } else {
    // phone
    if (rec.download_url && !demoMode) {
      const href = `/api/phone/recordings/download?url=${encodeURIComponent(
        rec.download_url
      )}`;
      filesCell = (
        <a href={href} className="text-sky-400 hover:underline">
          Recording
        </a>
      );
    }
  }

  const autoDeleteDate =
    (rec as any).autoDeleteDate ?? (rec as any).auto_delete_date ?? "";

  return (
    <tr key={rowKey} className="rec-row">
      <td>
        <input
          type="checkbox"
          checked={selectedKeys.has(rowKey)}
          onChange={() => toggleRowSelection(rec, globalIndex)}
        />
      </td>
      <td>{dateDisplay}</td>
      <td>{primary}</td>
      <td>{ownerDisplay}</td>

      <td>{filesCell}</td>
      <td>{sizeDisplay}</td>

      <td>{isMeeting ? plays ?? "—" : ""}</td>
      <td>{isMeeting ? downloads ?? "—" : ""}</td>
      <td>{isMeeting ? (lastAccessDate || "—") : ""}</td>

      <td>{isMeeting && autoDeleteDate ? autoDeleteDate : ""}</td>
    </tr>
  );
})
          }
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default RecordingsTable;
