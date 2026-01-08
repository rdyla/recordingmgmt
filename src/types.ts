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
 
  // CC extras
  cc_recording_id?: string;
  cc_download_url?: string;
  cc_transcript_url?: string;
  cc_playback_url?: string;
  cc_queue_name?: string;
  cc_flow_name?: string;
  cc_channel?: string;
  cc_direction?: string;

  // “caller” + “agent”
  cc_consumer_name?: string;
  cc_consumer_number?: string;
  cc_agent_name?: string;
  cc_agent_email?: string;

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

  // meeting-only: auto-delete flags
  autoDelete?: boolean | null;
  autoDeleteDate?: string | null; // "YYYY-MM-DD"
};

// types.ts

export type RecordingSource = "phone" | "meetings" | "cc";
export type SourceFilter = "phone" | "meetings" | "cc";

export type ContactCenterConsumer = {
  consumer_name?: string;
  consumer_number?: string;
};

export type ContactCenterRecordingItem = {
  recording_id: string;
  cc_queue_id?: string;
  queue_name?: string;
  recording_duration?: number;

  download_url?: string;     // voice recording download
  transcript_url?: string;   // transcript download
  playback_url?: string;

  recording_start_time?: string;
  recording_end_time?: string;

  user_id?: string;
  display_name?: string; // agent name
  user_email?: string;

  recording_type?: string;
  channel?: string;      // voice/chat/etc
  direction?: string;

  owner_id?: string;
  owner_name?: string;   // queue name etc
  owner_type?: string;   // queue
  engagement_id?: string;

  flow_name?: string;
  flow_id?: string;

  consumers?: ContactCenterConsumer[];
};

export type ContactCenterApiResponse = {
  next_page_token?: string;
  page_size?: number;
  from?: string;
  to?: string;
  recordings?: ContactCenterRecordingItem[];
};



export type AnalyticsRow = {
  date?: string;
  views_total_count?: number;
  downloads_total_count?: number;
};

export type MeetingAnalyticsStats = {
  meetingId: string;
  plays: number;
  downloads: number;
  lastAccessDate: string; // YYYY-MM-DD or ""
};

export type ApiResponse = {
  next_page_token?: string | null;
  page_size?: number;
  total_records?: number;
  from?: string;
  to?: string;
  recordings?: Recording[];
};

export type MeetingItem = {
  uuid: string;
  id: number;
  topic: string;
  start_time: string;
  duration?: number;
  host_id: string;
  host_email?: string;
  owner_email?: string;
  owner_name?: string;
  auto_delete?: boolean;
  auto_delete_date?: string;
  autoDelete?: boolean;
  autoDeleteDate?: string;
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
