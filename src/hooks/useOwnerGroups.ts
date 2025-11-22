import { useCallback, useMemo, useState } from "react";
import type { Recording } from "../types";

export type PageRecord = { rec: Recording; globalIndex: number };

export type OwnerGroup = {
  key: string;
  ownerLabel: string;
  sourceLabel: string;
  siteLabel: string;
  items: PageRecord[];
  count: number;
  totalDuration: number;
  totalSizeBytes: number;
  firstDate: Date | null;
  lastDate: Date | null;
};

const useOwnerGroups = (
  pageRecordsWithIndex: PageRecord[],
  makeRecordKey: (rec: Recording, idx: number) => string,
  selectedKeys: Set<string>,
  setSelectedKeys: (updater: (prev: Set<string>) => Set<string>) => void
) => {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set()
  );

  const ownerGroups = useMemo(() => {
    const groupsMap = new Map<string, OwnerGroup>();

    for (const item of pageRecordsWithIndex) {
      const { rec } = item;
      const isMeeting = rec.source === "meetings";

      const ownerLabel = isMeeting
        ? rec.host_email || rec.owner?.name || "Unknown"
        : rec.owner?.name && rec.owner?.extension_number
        ? `${rec.owner.name} (${rec.owner.extension_number})`
        : rec.owner?.name || "Unknown";

      const sourceLabel = isMeeting ? "Meeting" : "Phone";
      const siteLabel = isMeeting ? "—" : rec.site?.name || "—";

      const groupKey = `${sourceLabel}|${ownerLabel}`;

      const dt = rec.date_time
        ? new Date(rec.date_time)
        : rec.end_time
        ? new Date(rec.end_time)
        : null;

      const existing = groupsMap.get(groupKey);
      if (!existing) {
        groupsMap.set(groupKey, {
          key: groupKey,
          ownerLabel,
          sourceLabel,
          siteLabel,
          items: [item],
          count: 1,
          totalDuration: rec.duration ?? 0,
          totalSizeBytes: rec.file_size ?? 0,
          firstDate: dt,
          lastDate: dt,
        });
      } else {
        existing.items.push(item);
        existing.count += 1;
        existing.totalDuration += rec.duration ?? 0;
        existing.totalSizeBytes += rec.file_size ?? 0;
        if (dt) {
          if (!existing.firstDate || dt < existing.firstDate) {
            existing.firstDate = dt;
          }
          if (!existing.lastDate || dt > existing.lastDate) {
            existing.lastDate = dt;
          }
        }
      }
    }

    return Array.from(groupsMap.values()).sort((a, b) =>
      a.ownerLabel.localeCompare(b.ownerLabel)
    );
  }, [pageRecordsWithIndex]);

  const collapseAllGroups = useCallback(() => {
    setCollapsedGroups(new Set(ownerGroups.map((g) => g.key)));
  }, [ownerGroups]);

  const expandAllGroups = useCallback(() => {
    setCollapsedGroups(new Set());
  }, []);

  const isGroupCollapsed = useCallback(
    (groupKey: string) => collapsedGroups.has(groupKey),
    [collapsedGroups]
  );

  const toggleGroupCollapse = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  const isGroupFullySelected = useCallback(
    (group: OwnerGroup): boolean => {
      if (!group.items.length) return false;
      return group.items.every(({ rec, globalIndex }) =>
        selectedKeys.has(makeRecordKey(rec, globalIndex))
      );
    },
    [makeRecordKey, selectedKeys]
  );

  const toggleGroupSelection = useCallback(
    (group: OwnerGroup, checked: boolean) => {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const { rec, globalIndex } of group.items) {
          const key = makeRecordKey(rec, globalIndex);
          if (checked) next.add(key);
          else next.delete(key);
        }
        return next;
      });
    },
    [makeRecordKey, setSelectedKeys]
  );

  return {
    ownerGroups,
    collapsedGroups,
    collapseAllGroups,
    expandAllGroups,
    isGroupCollapsed,
    toggleGroupCollapse,
    isGroupFullySelected,
    toggleGroupSelection,
  };
};

export default useOwnerGroups;
