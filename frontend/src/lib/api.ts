import axios from 'axios';
import type {
  User,
  Location,
  ShiftTemplate,
  ScheduledShift,
  TimeClock,
  TimeOffRequest,
  UnavailabilityRequest,
  ShiftSwapRequest,
  ShiftCoverageRequest,
  Message,
  CashDrawer,
  PayrollRecord,
  AuditLog,
  PaginatedResponse,
  LoginRequest,
  LoginResponse,
  DashboardSummary,
  LocationDashboardData,
  KioskAuthResponse,
  RequestStatus,
  UnexpectedExpense,
} from '@/types';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Redirect to login on 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

// ============================================================
// Auth
// ============================================================

export const auth = {
login: (data: LoginRequest) => {
  const formData = new URLSearchParams();
  formData.append('username', data.email);
  formData.append('password', data.password);
  formData.append('grant_type', 'password');
  
  return api.post<LoginResponse>('/auth/login', formData, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }).then((r) => r.data);
},

  register: (data: { email: string; password: string; first_name: string; last_name: string }) =>
    api.post<User>('/auth/register', data).then((r) => r.data),

  refreshToken: () =>
    api.post<{ access_token: string }>('/auth/refresh').then((r) => r.data),

  resetPassword: (data: { email: string }) =>
    api.post('/auth/reset-password', data).then((r) => r.data),
};

// ============================================================
// Users
// ============================================================

function normalizePaginated<T>(data: any): PaginatedResponse<T> {
  const items = data.items ?? data.users ?? data.logs ?? data.messages ?? data.records ?? data.entries ?? [];
  const total = data.total ?? 0;
  const per_page = data.per_page ?? 25;
  return { items, total, page: data.page ?? 1, per_page, total_pages: data.total_pages ?? Math.ceil(total / per_page) };
}

export const users = {
  list: (params?: { page?: number; per_page?: number; role?: string; location_id?: number }) =>
    api.get('/users', { params }).then((r) => normalizePaginated<User>(r.data)),

  get: (id: number) =>
    api.get<User>(`/users/${id}`).then((r) => r.data),

  create: (data: Partial<User> & { password: string }) =>
    api.post<User>('/users', data).then((r) => r.data),

  update: (id: number, data: Partial<User>) =>
    api.patch<User>(`/users/${id}`, data).then((r) => r.data),

  delete: (id: number) =>
    api.delete(`/users/${id}`).then((r) => r.data),
};

// ============================================================
// Locations
// ============================================================

export const locations = {
  list: () =>
    api.get<Location[]>('/locations').then((r) => r.data),

  get: (id: number) =>
    api.get<Location>(`/locations/${id}`).then((r) => r.data),

  create: (data: Partial<Location>) =>
    api.post<Location>('/locations', data).then((r) => r.data),

  update: (id: number, data: Partial<Location>) =>
    api.patch<Location>(`/locations/${id}`, data).then((r) => r.data),
};

// ============================================================
// Schedules
// ============================================================

export const schedules = {
  listTemplates: (locationId: number) =>
    api.get<ShiftTemplate[]>(`/schedules/templates`, { params: { location_id: locationId } }).then((r) => r.data),

  createTemplate: (data: Partial<ShiftTemplate>) =>
    api.post<ShiftTemplate>('/schedules/templates', data).then((r) => r.data),

  listShifts: (params: { location_id?: number; user_id?: number; start_date: string; end_date: string }) =>
    api.get('/schedules/week', { params: { week_start: params.start_date, location_id: params.location_id } }).then((r) => {
      const data = r.data as any;
      return (data.shifts ?? data ?? []) as ScheduledShift[];
    }),

  createShift: (data: Partial<ScheduledShift>) =>
    api.post<ScheduledShift>('/schedules/shifts', data).then((r) => r.data),

  copyWeek: (data: { location_id: number; source_week_start: string; target_week_start: string }) =>
    api.post<ScheduledShift[]>('/schedules/copy-week', data).then((r) => r.data),

  getAvailability: (params: { location_id: number; date: string }) =>
    api.get<User[]>('/schedules/availability', { params }).then((r) => r.data),
};

// ============================================================
// Time Clock
// ============================================================

export const timeClock = {
  clockIn: (data: { location_id: number; notes?: string }) =>
    api.post<TimeClock>('/time-clock/clock-in', data).then((r) => r.data),

  clockOut: (id: number) =>
    api.post<TimeClock>(`/time-clock/${id}/clock-out`).then((r) => r.data),

  startBreak: (id: number, data: { break_type: string }) =>
    api.post<TimeClock>(`/time-clock/${id}/break/start`, data).then((r) => r.data),

  endBreak: (id: number) =>
    api.post<TimeClock>(`/time-clock/${id}/break/end`).then((r) => r.data),

  getRecords: (params: { user_id?: number; location_id?: number; start_date?: string; end_date?: string; page?: number; per_page?: number }) =>
    api.get<PaginatedResponse<TimeClock>>('/time-clock', { params }).then((r) => r.data),

  adjustTime: (id: number, data: { clock_in?: string; clock_out?: string; notes?: string }) =>
    api.patch<TimeClock>(`/time-clock/${id}`, data).then((r) => r.data),
};

// ============================================================
// Time Off
// ============================================================

export const timeOff = {
  list: (params?: { user_id?: number; status?: RequestStatus; page?: number; per_page?: number }) =>
    api.get<PaginatedResponse<TimeOffRequest>>('/time-off', { params }).then((r) => r.data),

  create: (data: { start_date: string; end_date: string; reason: string }) =>
    api.post<TimeOffRequest>('/time-off', data).then((r) => r.data),

  review: (id: number, data: { status: RequestStatus; review_notes?: string }) =>
    api.patch<TimeOffRequest>(`/time-off/${id}/review`, data).then((r) => r.data),
};

// ============================================================
// Unavailability
// ============================================================

export const unavailability = {
  list: (params?: { user_id?: number; status?: RequestStatus }) =>
    api.get<UnavailabilityRequest[]>('/unavailability', { params }).then((r) => r.data),

  create: (data: { day_of_week: number; start_time: string; end_time: string; reason?: string }) =>
    api.post<UnavailabilityRequest>('/unavailability', data).then((r) => r.data),

  review: (id: number, data: { status: RequestStatus }) =>
    api.patch<UnavailabilityRequest>(`/unavailability/${id}/review`, data).then((r) => r.data),
};

// ============================================================
// Shift Swaps
// ============================================================

export const shiftSwaps = {
  list: (params?: { status?: RequestStatus; page?: number; per_page?: number }) =>
    api.get<PaginatedResponse<ShiftSwapRequest>>('/shift-swaps', { params }).then((r) => r.data),

  create: (data: { target_id: number; requester_shift_id: number; target_shift_id: number }) =>
    api.post<ShiftSwapRequest>('/shift-swaps', data).then((r) => r.data),

  review: (id: number, data: { status: RequestStatus }) =>
    api.patch<ShiftSwapRequest>(`/shift-swaps/${id}/review`, data).then((r) => r.data),
};

// ============================================================
// Shift Coverage
// ============================================================

export const shiftCoverage = {
  list: (params?: { status?: RequestStatus; page?: number; per_page?: number }) =>
    api.get<PaginatedResponse<ShiftCoverageRequest>>('/shift-coverage', { params }).then((r) => r.data),

  post: (data: { shift_id: number; reason: string }) =>
    api.post<ShiftCoverageRequest>('/shift-coverage', data).then((r) => r.data),

  claim: (id: number) =>
    api.post<ShiftCoverageRequest>(`/shift-coverage/${id}/claim`).then((r) => r.data),

  review: (id: number, data: { status: RequestStatus }) =>
    api.patch<ShiftCoverageRequest>(`/shift-coverage/${id}/review`, data).then((r) => r.data),
};

// ============================================================
// Messages
// ============================================================

export const messages = {
  list: (params?: { page?: number; per_page?: number }) =>
    api.get<PaginatedResponse<Message>>('/messages', { params }).then((r) => r.data),

  send: (data: { recipient_id: number; subject?: string; body: string }) =>
    api.post<Message>('/messages', data).then((r) => r.data),

  getAnnouncements: (params?: { location_id?: number }) =>
    api.get<Message[]>('/messages/announcements', { params }).then((r) => r.data),

  sendAnnouncement: (data: { location_id?: number; subject?: string; body: string }) =>
    api.post<Message>('/messages/announcements', data).then((r) => r.data),
};

// ============================================================
// Cash Drawer
// ============================================================

export const cashDrawer = {
  open: (data: { location_id: number; starting_cash: number }) =>
    api.post<CashDrawer>('/cash-drawer/open', data).then((r) => r.data),

  close: (id: number, data: { actual_cash: number; notes?: string }) =>
    api.post<CashDrawer>(`/cash-drawer/${id}/close`, data).then((r) => r.data),

  addExpense: (id: number, data: { description: string; amount: number }) =>
    api.post<UnexpectedExpense>(`/cash-drawer/${id}/expense`, data).then((r) => r.data),

  getReport: (params: { location_id?: number; start_date?: string; end_date?: string }) =>
    api.get<CashDrawer[]>('/cash-drawer/report', { params }).then((r) => r.data),
};

// ============================================================
// Payroll
// ============================================================

export const payroll = {
  generate: (data: { location_id: number; period_start: string; period_end: string }) =>
    api.post<PayrollRecord[]>('/payroll/generate', data).then((r) => r.data),

  approve: (ids: number[]) =>
    api.post('/payroll/approve', { record_ids: ids }).then((r) => r.data),

  exportCsv: (params: { period_start: string; period_end: string; location_id?: number }) =>
    api.get('/payroll/export', { params, responseType: 'blob' }).then((r) => r.data),

  aiValidate: (data: { period_start: string; period_end: string; location_id?: number }) =>
    api.post<{ issues: string[]; summary: string }>('/payroll/ai-validate', data).then((r) => r.data),
};

// ============================================================
// Dashboard
// ============================================================

export const dashboard = {
  getSummary: () =>
    api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data),

  getLocationData: (locationId: number) =>
    api.get<LocationDashboardData>(`/dashboard/location/${locationId}`).then((r) => r.data),
};

// ============================================================
// Kiosk
// ============================================================

export const kiosk = {
  authenticate: (data: { pin_code: string; location_id: number }) =>
    api.post<KioskAuthResponse>('/kiosk/authenticate', data).then((r) => r.data),

  clockIn: (data: { session_token: string; location_id: number }) =>
    api.post<TimeClock>('/kiosk/clock-in', data).then((r) => r.data),

  clockOut: (data: { session_token: string; time_clock_id: number }) =>
    api.post<TimeClock>('/kiosk/clock-out', data).then((r) => r.data),

  startBreak: (data: { session_token: string; time_clock_id: number; break_type: string }) =>
    api.post<TimeClock>('/kiosk/break/start', data).then((r) => r.data),

  endBreak: (data: { session_token: string; time_clock_id: number }) =>
    api.post<TimeClock>('/kiosk/break/end', data).then((r) => r.data),

  startDrawer: (data: { session_token: string; location_id: number; starting_cash: number }) =>
    api.post<CashDrawer>('/kiosk/drawer/start', data).then((r) => r.data),

  endDrawer: (data: { session_token: string; drawer_id: number; actual_cash: number; notes?: string }) =>
    api.post<CashDrawer>('/kiosk/drawer/end', data).then((r) => r.data),

  addExpense: (data: { session_token: string; drawer_id: number; description: string; amount: number }) =>
    api.post<UnexpectedExpense>('/kiosk/drawer/expense', data).then((r) => r.data),

  getTodaySchedule: (locationId: number) =>
    api.get<ScheduledShift[]>(`/kiosk/schedule/${locationId}`).then((r) => r.data),
};

// ============================================================
// Audit
// ============================================================

export const audit = {
  list: (params?: { user_id?: number; action?: string; resource_type?: string; page?: number; per_page?: number }) =>
    api.get<PaginatedResponse<AuditLog>>('/audit', { params }).then((r) => r.data),
};

export default api;
