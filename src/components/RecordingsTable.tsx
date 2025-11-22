import React from "react";
import type { OwnerGroup, PageRecord } from "../hooks/useOwnerGroups";
import type { Recording } from "../types";
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
};

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
}) => {
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
            <th>Source</th>
            <th>Primary</th>
            <th>Owner / Host</th>
            <th>Site</th>
            <th>Files</th>
            <th>Size</th>
            <th>Type</th>
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
                <tr className="rec-row group-row">
                  <td>
                    <input
                      type="checkbox"
                      checked={groupSelected}
                      onChange={(e) => toggleGroupSelection(group, e.target.checked)}
                    />
                  </td>
                  <td colSpan={8}>
                    <button
                      type="button"
                      className="group-toggle"
                      onClick={() => toggleGroupCollapse(group.key)}
                      style={{
                        marginRight: 8,
                        cursor: "pointer",
                        border: "none",
                        background: "transparent",
                      }}
                    >
                      {collapsed ? "▶" : "▼"}
                    </button>
                    <strong>{group.ownerLabel}</strong>{" "}
                    <span style={{ opacity: 0.8 }}>
                      · {group.sourceLabel} · {group.count} recording
                      {group.count !== 1 ? "s" : ""} · Total size {formatBytes(group.totalSizeBytes)} · {dateRangeLabel}
                    </span>
                  </td>
                </tr>

                {!collapsed &&
                  group.items.map(({ rec, globalIndex }: PageRecord) => {
                    const key = makeRecordKey(rec, globalIndex);
                    const isMeeting = rec.source === "meetings";

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

                    const primary = isMeeting
                      ? rec.topic || rec.caller_name || "Meeting"
                      : rec.caller_name && rec.caller_number
                      ? `${rec.caller_name} (${rec.caller_number})`
                      : rec.caller_name || rec.caller_number || "—";

                    const ownerDisplay = isMeeting
                      ? rec.host_email || rec.owner?.name || "—"
                      : rec.owner?.name && rec.owner?.extension_number
                      ? `${rec.owner.name} (${rec.owner.extension_number})`
                      : rec.owner?.name || "—";

                    const siteName = isMeeting ? "Meeting" : rec.site?.name || "—";
                    const sourceLabel = isMeeting ? "Meeting" : "Phone";
                    const sizeDisplay = formatBytes(rec.file_size);

                    let filesDisplay: React.ReactNode = "—";

                    if (isMeeting) {
                      const files = rec.recording_files ?? [];
                      const fileCount = rec.files_count ?? files.length;

                      if (fileCount > 0) {
                        const seenTypes = new Set<string>();
                        const fileLinks: React.ReactNode[] = [];

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
                            ? new Date(rec.date_time).toISOString().slice(0, 19).replace(/[:T]/g, "-")
                            : "recording";

                          const ext = (f.file_extension || f.file_type || "").toLowerCase() || "dat";

                          const filename = `${safeTopic}_${dtPart}.${ext}`;

                          const href = `/api/meeting/recordings/download?url=${encodeURIComponent(
                            f.download_url
                          )}&filename=${encodeURIComponent(filename)}`;

                          fileLinks.push(
                            <a key={t} href={href} className="text-sky-400 hover:underline">
                              {t}
                            </a>
                          );
                        }

                        filesDisplay = (
                          <>
                            {fileCount} file
                            {fileCount !== 1 ? "s" : ""}
                            {fileLinks.length > 0 && (
                              <>
                                {" ("}
                                {fileLinks.map((link, i) => (
                                  <React.Fragment key={i}>
                                    {i > 0 && ", "}
                                    {link}
                                  </React.Fragment>
                                ))}
                                {")"}
                              </>
                            )}
                          </>
                        );
                      }
                    } else {
                      if (rec.download_url && !demoMode) {
                        const href = `/api/phone/recordings/download?url=${encodeURIComponent(
                          rec.download_url
                        )}`;
                        filesDisplay = (
                          <a href={href} className="text-sky-400 hover:underline">
                            Recording
                          </a>
                        );
                      }
                    }

                    return (
                      <tr key={key} className="rec-row">
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(key)}
                            onChange={() => toggleRowSelection(rec, globalIndex)}
                          />
                        </td>
                        <td>{dateDisplay}</td>
                        <td>{sourceLabel}</td>
                        <td>{primary}</td>
                        <td>{ownerDisplay}</td>
                        <td>{siteName}</td>
                        <td>{filesDisplay}</td>
                        <td>{sizeDisplay}</td>
                        <td>{rec.recording_type || "—"}</td>
                      </tr>
                    );
                  })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default RecordingsTable;
