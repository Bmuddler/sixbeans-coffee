// ============================================================
// Enums
// ============================================================

export enum UserRole {
  OWNER = 'owner',
  MANAGER = 'manager',
  EMPLOYEE = 'employee',
}

export enum RequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  DENIED = 'denied',
}

export enum BreakType {
  PAID = 'paid',
  UNPAID = 'unpaid',
}

export enum ShiftStatus {
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  MISSED = 'missed',
  CANCELLED = 'cancelled',
}

export enum PayrollStatus {
  DRAFT = 'draft',
  GENERATED = 'generated',
  APPROVED = 'approved',
  EXPORTED = 'exported',
}

// ============================================================
// Core Models
// ============================================================

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  role: UserRole;
  primary_location_id: number;
  secondary_location_ids: number[];
  hire_date: string;
  hourly_rate: number;
  is_active: boolean;
  pin_code?: string;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: number;
  name: string;
  address: string;
  phone?: string;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShiftTemplate {
  id: number;
  location_id: number;
  name: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  role_label?: string;
  min_staff: number;
  created_at: string;
}

export interface ScheduledShift {
  id: number;
  template_id?: number;
  location_id: number;
  user_id: number;
  date: string;
  start_time: string;
  end_time: string;
  status: ShiftStatus;
  role_label?: string;
  notes?: string;
  user?: User;
  location?: Location;
  created_at: string;
  updated_at: string;
}

export interface Break {
  id: number;
  time_clock_id: number;
  break_type: BreakType;
  start_time: string;
  end_time?: string;
  duration_minutes?: number;
}

export interface TimeClock {
  id: number;
  user_id: number;
  location_id: number;
  clock_in: string;
  clock_out?: string;
  total_hours?: number;
  is_kiosk: boolean;
  breaks: Break[];
  notes?: string;
  user?: User;
  location?: Location;
  created_at: string;
}

export interface TimeOffRequest {
  id: number;
  user_id: number;
  start_date: string;
  end_date: string;
  reason: string;
  status: RequestStatus;
  reviewed_by?: number;
  review_notes?: string;
  user?: User;
  reviewer?: User;
  created_at: string;
  updated_at: string;
}

export interface UnavailabilityRequest {
  id: number;
  user_id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  reason?: string;
  status: RequestStatus;
  reviewed_by?: number;
  user?: User;
  created_at: string;
}

export interface ShiftSwapRequest {
  id: number;
  requester_id: number;
  target_id: number;
  requester_shift_id: number;
  target_shift_id: number;
  status: RequestStatus;
  reviewed_by?: number;
  requester?: User;
  target?: User;
  requester_shift?: ScheduledShift;
  target_shift?: ScheduledShift;
  created_at: string;
}

export interface ShiftCoverageRequest {
  id: number;
  shift_id: number;
  posted_by: number;
  claimed_by?: number;
  reason: string;
  status: RequestStatus;
  reviewed_by?: number;
  shift?: ScheduledShift;
  poster?: User;
  claimer?: User;
  created_at: string;
}

export interface Message {
  id: number;
  sender_id: number;
  recipient_id?: number;
  location_id?: number;
  subject?: string;
  body: string;
  is_announcement: boolean;
  is_read: boolean;
  sender?: User;
  recipient?: User;
  created_at: string;
}

export interface UnexpectedExpense {
  id: number;
  drawer_id: number;
  description: string;
  amount: number;
  created_at: string;
}

export interface CashDrawer {
  id: number;
  location_id: number;
  opened_by: number;
  closed_by?: number;
  open_time: string;
  close_time?: string;
  starting_cash: number;
  expected_cash?: number;
  actual_cash?: number;
  variance?: number;
  expenses: UnexpectedExpense[];
  notes?: string;
  opener?: User;
  closer?: User;
  location?: Location;
  created_at: string;
}

export interface PayrollRecord {
  id: number;
  user_id: number;
  location_id: number;
  period_start: string;
  period_end: string;
  regular_hours: number;
  overtime_hours: number;
  total_pay: number;
  status: PayrollStatus;
  approved_by?: number;
  user?: User;
  location?: Location;
  created_at: string;
}

export interface AuditLog {
  id: number;
  user_id: number;
  action: string;
  resource_type: string;
  resource_id?: number;
  details?: Record<string, unknown>;
  ip_address?: string;
  user?: User;
  created_at: string;
}

// ============================================================
// API Response Types
// ============================================================

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface DashboardSummary {
  active_employees: number;
  today_shifts: number;
  pending_requests: number;
  clocked_in_count: number;
  open_drawers: number;
  weekly_hours: number;
  announcements: Message[];
}

export interface LocationDashboardData {
  location: Location;
  today_shifts: ScheduledShift[];
  clocked_in: TimeClock[];
  pending_time_off: number;
  pending_swaps: number;
  open_drawer?: CashDrawer;
}

export interface KioskAuthResponse {
  user: User;
  session_token: string;
  today_shifts: ScheduledShift[];
  active_clock?: TimeClock;
}
