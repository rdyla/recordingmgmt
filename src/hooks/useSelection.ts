import { useCallback, useState } from "react";

const useSelection = () => {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set()
  );

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  const toggleSelection = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const applySelection = useCallback((keys: string[], checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (checked) {
          next.add(key);
        } else {
          next.delete(key);
        }
      }
      return next;
    });
  }, []);

  return { selectedKeys, setSelectedKeys, clearSelection, toggleSelection, applySelection };
};

export default useSelection;
