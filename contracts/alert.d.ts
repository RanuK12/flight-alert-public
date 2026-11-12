export type PlanName = 'free' | 'trial' | 'pro';
export type TripType = 'oneway' | 'roundtrip';
export type PausedReason = 'plan_limit' | 'expired' | 'user' | null;
export type CeilingSource = 'manual' | 'suggested' | null;

export interface AlertView {
  id: string;
  origin: string;
  destination: string;
  tripType: TripType;
  outboundDate: string | null;
  returnDate: string | null;
  flexMonth: string | null;
  stayDays: number | null;
  notify: 'daily' | 'drop';
  ceiling: number | null;
  ceilingSource: CeilingSource;
  currency: string;
  paused: boolean;
  pausedByBilling: boolean;
  pausedReason: PausedReason;
  version: number;
  lastPrice: number | null;
  seen_at: string | null;
}

export interface AlertsListResponse {
  items: AlertView[];
  used: number;
  cap: number;
  plan: PlanName;
  safeMode: boolean;
}

export interface PlanSpec {
  maxActiveAlerts: number;
  digestEnabled: boolean;
  instantTotalMax?: number | null;
  instantPerDayMax?: number | null;
  searchesPerMonth?: number | null;
  days?: number | null;
}

export interface PlansResponse {
  safeMode: boolean;
  source: 'env' | 'db' | 'safe' | string;
  checkIntervalMin: number;
  free: PlanSpec;
  trial: PlanSpec;
  pro: PlanSpec;
}

export interface SuggestResponse {
  suggested: number | null;
  confidence: 'ok' | 'cold' | 'none';
  samples: number;
  currency: string;
  median?: number;
}

export interface SearchResultItem {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string | null;
  price: number;
  currency: string;
  stops: number;
  seen_at: string;
  url: string;
  existingAlertId: string | null;
}

export interface SeriesPoint {
  day: string;
  price: number;
  currency: string;
  seenAt?: string;
}

export interface AlertSeriesResponse {
  alertId: string;
  origin: string;
  destination: string;
  ceiling: number | null;
  points: SeriesPoint[];
  status: 'ok' | 'cold' | 'none';
}

export interface MeResponse {
  id: string;
  lang: 'es' | 'en' | 'pt';
  plan: PlanName;
  pro: boolean;
  proUntil: string | null;
  trialUsed: boolean;
  trialEndsAt: string | null;
  safeMode: boolean;
  quota: {
    alerts: { used: number; cap: number };
    searches: { used: number; cap: number | null };
    instant: { used: number; cap: number | null; remaining: number | null };
  };
  features: {
    mp: boolean;
    stars: boolean;
    alerts: boolean;
  };
  botUsername: string;
}

export interface ApiErrorBody {
  error: {
    code:
      | 'PAYWALL'
      | 'LIMIT_REACHED'
      | 'PLAN_CONFIG_UNAVAILABLE'
      | 'VERSION_CONFLICT'
      | 'VALIDATION'
      | 'NOT_FOUND'
      | 'UNAUTHORIZED'
      | string;
    message?: string;
    text?: string;
    limit?: number;
    cap?: number;
    used?: number;
    plan?: PlanName;
    version?: number;
  };
}
