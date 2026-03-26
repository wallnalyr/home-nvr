export interface FrigateEvent {
  id: string;
  camera: string;
  label: string;
  sub_label: string | null;
  top_score: number;
  score: number;
  start_time: number;
  end_time: number | null;
  has_clip: boolean;
  has_snapshot: boolean;
  thumbnail: string;
  zones: string[];
  area: number | null;
  ratio: number | null;
  region: number[] | null;
  current_zones: string[];
  entered_zones: string[];
  false_positive: boolean | null;
  plus_id: string | null;
  retain_indefinitely: boolean;
  data: {
    type: string;
    score: number;
    top_score: number;
  };
}

export interface FrigateEventFilters {
  camera?: string;
  label?: string;
  zone?: string;
  after?: number;
  before?: number;
  has_clip?: boolean;
  has_snapshot?: boolean;
  limit?: number;
  favorites?: boolean;
}
