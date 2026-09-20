export type NetworkEvent = {
  timestamp: string;
  process_name: string;
  domain: string;
  destination_ip: string;
  protocol: string;
  port: number;
  state: string;

  /** Only set for packet-level flows (ICMP, IGMP, GRE, ...). */
  packets?: number;
  bytes?: number;

  /** Local port of the socket (0 for packet-level flows). */
  local_port?: number;
};

export type BrowserEvent = {
  timestamp: string;
  event_type: string;
  tab_id: number;

  page_url: string | null;
  page_domain: string | null;

  domain: string;
  path: string;

  initiator: string | null;

  method: string;
  resource_type: string;
};

export type DnsEvent = {
  timestamp: string;
  domain: string;
  ip: string;
  type: string;
};

export type GeoLocation = {
  ip: string;
  success: boolean;
  reason: string | null;

  latitude: number | null;
  longitude: number | null;

  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;

  organization: string | null;
};

export type GeoMarker = {
  id: string;
  position: [number, number];
  color: string;
  popup: string;
};

export type UploadInfo = {
  loaded: boolean;
  filename: string;
  event_count: number;
  error: string;
};