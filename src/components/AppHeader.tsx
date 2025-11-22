import React from "react";
import type { MeetingIdentity, SourceFilter } from "../types";

type Props = {
  from: string;
  to: string;
  source: SourceFilter;
  dataFrom?: string;
  dataTo?: string;
  demoMode: boolean;
  meetingIdentity: MeetingIdentity | null;
};

const AppHeader: React.FC<Props> = ({
  from,
  to,
  source,
  dataFrom,
  dataTo,
  demoMode,
  meetingIdentity,
}) => {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <h1 className="app-title">Zoom Recording Explorer</h1>
        <p className="app-subtitle">
          Source: {source === "phone" ? "Phone" : "Meetings"} · {dataFrom ?? from} → {dataTo ?? to}
          {meetingIdentity && source === "meetings" && (
            <>
              {" "}
              · Meetings user: {meetingIdentity.userId}
              {meetingIdentity.source === "default_me" && " (me)"}
            </>
          )}
          {demoMode && (
            <>
              {" "}
              · <strong>DEMO MODE</strong> (fake data)
            </>
          )}
        </p>
      </div>
    </header>
  );
};

export default AppHeader;
