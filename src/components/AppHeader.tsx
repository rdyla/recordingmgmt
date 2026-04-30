import React from "react";
import type {
  MeetingIdentity,
  MeResponse,
  SourceFilter,
} from "../types";

type Props = {
  from: string;
  to: string;
  source: SourceFilter;
  dataFrom?: string;
  dataTo?: string;
  demoMode: boolean;
  meetingIdentity: MeetingIdentity | null;
  me: MeResponse | null;
  onSwitchTenant?: (slug: string) => void;
  switching?: boolean;
};

const AppHeader: React.FC<Props> = ({
  from,
  to,
  source,
  dataFrom,
  dataTo,
  demoMode,
  meetingIdentity,
  me,
  onSwitchTenant,
  switching,
}) => {
  const sourceLabel =
    source === "phone"
      ? "Phone"
      : source === "meetings"
      ? "Meetings"
      : source === "voicemail"
      ? "Voicemail"
      : "Contact Center";

  const active = me?.activeTenant;
  const isProd = !!active?.isProduction;
  const canSwitch =
    !!me?.isSuperAdmin && (me.availableTenants?.length || 0) > 1;

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h1 className="app-title">Zoom Recording Explorer</h1>

          {active && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 700,
                  background: isProd ? "#7f1d1d" : "#1f2937",
                  color: isProd ? "#fecaca" : "#cbd5e1",
                  border: `1px solid ${isProd ? "#dc2626" : "#374151"}`,
                  letterSpacing: 0.5,
                }}
                title={isProd ? "Production tenant" : "Test tenant"}
              >
                {isProd ? "PROD" : "TEST"}
              </span>

              {canSwitch ? (
                <select
                  className="form-control"
                  value={active.slug}
                  disabled={switching}
                  onChange={(e) => onSwitchTenant?.(e.target.value)}
                  style={{ minWidth: 200 }}
                  title="Switch tenant (super-admin)"
                >
                  {me!.availableTenants.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.displayName}
                      {t.isProduction ? " (prod)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <strong style={{ fontSize: 14 }}>{active.displayName}</strong>
              )}

              {me?.email && (
                <span style={{ opacity: 0.7, fontSize: 12 }}>{me.email}</span>
              )}
            </div>
          )}
        </div>

        <p className="app-subtitle">
          Source: {sourceLabel} · {dataFrom ?? from} → {dataTo ?? to}
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
