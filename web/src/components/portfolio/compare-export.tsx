"use client";

import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { buttonClass } from "@/components/ui/button";

/** Downloads the comparison as CSV (built on the server by comparisonCsv; nothing leaves the browser). */
export function CompareExport({ csv, disabled }: { csv: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={buttonClass("secondary", "md")}
      onClick={() => {
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "trades-next-to-the-rules.csv";
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      <DownloadSimpleIcon size={16} aria-hidden /> Export CSV
    </button>
  );
}
