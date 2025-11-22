export type Owner = {
  type: string;
  id: string;
  name: string;
  extension_number?: number;
};

export type Site = {
  id: string;
  name: string;
};

export type MeetingIdentity = {
  userId: string;
  source: string; // e.g. "account_recordings"
};

export type RecordingSource = "phone" | "meetings";

export type MeetingRecordingFile = {
  id?: string;
  recording_start?: string;
  recording_end?: string;
  download_url?: string;
  file_type?: string;
  file_extension?: string;
  file_size?: number;
  recording_type?: string;
};

export type Recording = {
  id: string;
  caller_number: string;
  caller_number_type: number;
  caller_name?: string;
  callee_number: string;
  callee_number_type: number;
  callee_name?: string;
  direction: "inbound" | "outbound" | string;
  duration: number;
  download_url?: string;
  date_time: string;
  recording_type: string;
  call_log_id?: string;
  call_history_id?: string;
  call_id?: string;
  owner?: Owner;
  site?: Site;
  call_element_id?: string;
  end_time?: string;
  disclaimer_status?: number;

  // size in bytes (phone: Zoom's; meetings: total of child files)
  file_size?: number;

  // extras
  source?: RecordingSource;
  topic?: string;
  host_name?: string;
  host_email?: string;
  meetingId?: string; // UUID for meeting delete API

  // meeting-only: summary of child files
  recording_files?: MeetingRecordingFile[];
  files_count?: number;
  files_types?: string[];
};

export type ApiResponse = {
  next_page_token?: string | null;
  page_size?: number;
  total_records?: number;
  from?: string;
  to?: string;
  recordings?: Recording[];
};

export type SourceFilter = "phone" | "meetings";

export type MeetingItem = {
  uuid: string;
  id: number;
  topic: string;
  start_time: string;
  duration?: number;
  host_id: string;
  host_email: string;
  recording_files?: MeetingRecordingFile[];
};

export type MeetingApiResponse = {
  from?: string;
  to?: string;
  page_size?: number;
  next_page_token?: string;
  meetings?: MeetingItem[];
};

export type DeleteProgress = {
  total: number;
  done: number;
};
