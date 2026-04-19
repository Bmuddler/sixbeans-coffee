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

export const api = axios.create({
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
    api.post('/auth/password-reset-request', data).then((r) => r.data),

  changePassword: (data: { new_password: string }) =>
    api.post('/auth/change-password', data).then((r) => r.data),
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

  getSmsPreferences: () =>
    api.get('/users/me/sms-preferences').then((r) => r.data),

  updateSmsPreferences: (data: Record<string, boolean>) =>
    api.patch('/users/me/sms-preferences', data).then((r) => r.data),
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
      return { shifts: (data.shifts ?? []) as ScheduledShift[], week_status: (data.week_status ?? 'draft') as string, published_at: data.published_at as string | null };
    }),

  publishWeek: (params: { week_start: string; location_id: number }) =>
    api.post('/schedules/publish', null, { params }).then((r) => r.data),

  unpublishWeek: (params: { week_start: string; location_id: number }) =>
    api.post('/schedules/unpublish', null, { params }).then((r) => r.data),

  createShift: (data: Partial<ScheduledShift>) =>
    api.post<ScheduledShift>('/schedules/shifts', data).then((r) => r.data),

  copyWeek: (data: { location_id: number; source_week_start: string; target_week_start: string }) =>
    api.post<ScheduledShift[]>('/schedules/copy-week', data).then((r) => r.data),

  getAvailability: (params: { location_id: number; date: string }) =>
    api.get<User[]>('/schedules/availability', { params }).then((r) => r.data),

  myShifts: () =>
    api.get('/schedules/my-shifts').then((r) => r.data as ScheduledShift[]),
};

// ============================================================
// Time Clock
// ============================================================

export const timeClock = {
  clockIn: (data: { location_id: number; notes?: string }) =>
    api.post<TimeClock>('/time-clock/clock-in', data).then((r) => r.data),

  clockOut: () =>
    api.post<TimeClock>('/time-clock/clock-out').then((r) => r.data),

  startBreak: (data: { break_type: string }) =>
    api.post('/time-clock/break/start', data).then((r) => r.data),

  endBreak: () =>
    api.post('/time-clock/break/end').then((r) => r.data),

  getRecords: (params: { user_id?: number; location_id?: number; start_date?: string; end_date?: string; page?: number; per_page?: number }) =>
    api.get('/time-clock/entries', {
      params: {
        employee_id: params.user_id,
        location_id: params.location_id,
        start_date: params.start_date,
        end_date: params.end_date,
        page: params.page,
        per_page: params.per_page,
      },
    }).then((r) => {
      const data = r.data as any;
      const items = data.entries ?? data.items ?? [];
      return { items, total: data.total ?? items.length, page: data.page ?? 1, per_page: data.per_page ?? 25, total_pages: data.total_pages ?? Math.ceil((data.total ?? items.length) / (data.per_page ?? 25)) } as PaginatedResponse<TimeClock>;
    }),

  adjustTime: (id: number, data: { clock_in?: string; clock_out?: string; notes?: string }) =>
    api.patch<TimeClock>(`/time-clock/${id}/adjust`, data).then((r) => r.data),

  mySummary: (params: { period_start: string; period_end: string }) =>
    api.get('/time-clock/my-summary', { params }).then((r) => r.data),
};

// ============================================================
// Time Off
// ============================================================

export const timeOff = {
  list: (params?: { user_id?: number; status?: RequestStatus; page?: number; per_page?: number }) =>
    api.get('/time-off/requests', {
      params: {
        employee_id: params?.user_id,
        status_filter: params?.status,
      },
    }).then((r) => {
      const data = r.data as any;
      const items = Array.isArray(data) ? data : (data.items ?? []);
      return { items, total: items.length, page: 1, per_page: items.length, total_pages: 1 } as PaginatedResponse<TimeOffRequest>;
    }),

  create: (data: { start_date: string; end_date: string; reason: string }) =>
    api.post<TimeOffRequest>('/time-off/requests', data).then((r) => r.data),

  review: (id: number, data: { status: RequestStatus; review_notes?: string }) =>
    api.patch<TimeOffRequest>(`/time-off/requests/${id}/review`, data).then((r) => r.data),
};

// ============================================================
// Unavailability
// ============================================================

export const unavailability = {
  list: (params?: { user_id?: number; status?: RequestStatus }) =>
    api.get<UnavailabilityRequest[]>('/time-off/unavailability', { params }).then((r) => r.data),

  create: (data: { day_of_week: number; start_time: string; end_time: string; reason?: string }) =>
    api.post<UnavailabilityRequest>('/time-off/unavailability', data).then((r) => r.data),

  review: (id: number, data: { status: RequestStatus }) =>
    api.patch<UnavailabilityRequest>(`/time-off/unavailability/${id}/review`, data).then((r) => r.data),
};

// ============================================================
// Shift Swaps
// ============================================================

export const shiftSwaps = {
  list: (params?: { status?: RequestStatus; page?: number; per_page?: number }) =>
    api.get<ShiftSwapRequest[]>('/shift-swap/swap', { params }).then((r) => {
      const data = r.data as any;
      const items = Array.isArray(data) ? data : (data.items ?? []);
      return { items, total: items.length, page: 1, per_page: items.length, total_pages: 1 } as PaginatedResponse<ShiftSwapRequest>;
    }),

  create: (data: { target_id: number; requester_shift_id: number; target_shift_id: number }) =>
    api.post<ShiftSwapRequest>('/shift-swap/swap', {
      target_employee_id: data.target_id,
      requesting_shift_id: data.requester_shift_id,
      target_shift_id: data.target_shift_id,
    }).then((r) => r.data),

  review: (id: number, data: { status: RequestStatus }) =>
    api.patch<ShiftSwapRequest>(`/shift-swap/swap/${id}/review`, data).then((r) => r.data),
};

// ============================================================
// Shift Coverage
// ============================================================

export const shiftCoverage = {
  list: (params?: { status?: RequestStatus; page?: number; per_page?: number }) =>
    api.get<ShiftCoverageRequest[]>('/shift-swap/coverage', { params }).then((r) => {
      const data = r.data as any;
      const items = Array.isArray(data) ? data : (data.items ?? []);
      return { items, total: items.length, page: 1, per_page: items.length, total_pages: 1 } as PaginatedResponse<ShiftCoverageRequest>;
    }),

  post: (data: { shift_id: number; reason: string }) =>
    api.post<ShiftCoverageRequest>('/shift-swap/coverage', {
      shift_id: data.shift_id,
      notes: data.reason,
    }).then((r) => r.data),

  claim: (id: number) =>
    api.post<ShiftCoverageRequest>(`/shift-swap/coverage/${id}/claim`).then((r) => r.data),

  review: (id: number, data: { status: RequestStatus }) =>
    api.patch<ShiftCoverageRequest>(`/shift-swap/coverage/${id}/review`, data).then((r) => r.data),
};

// ============================================================
// Messages
// ============================================================

export const messages = {
  list: (params?: { page?: number; per_page?: number; location_id?: number; announcements_only?: boolean }) =>
    api.get('/messaging/', { params }).then((r) => normalizePaginated<Message>(r.data)),

  send: (data: { body: string; location_id?: number; recipient_ids?: number[] }) =>
    api.post<Message>('/messaging/', {
      content: data.body,
      location_id: data.location_id ?? null,
      is_announcement: false,
      is_direct: (data.recipient_ids?.length ?? 0) > 0,
      recipient_ids: data.recipient_ids ?? [],
    }).then((r) => r.data),

  getAnnouncements: (params?: { location_id?: number }) =>
    api.get('/messaging/', { params: { ...params, announcements_only: true } }).then((r) => {
      const d = r.data as any;
      return (d.items ?? d.messages ?? []) as Message[];
    }),

  sendAnnouncement: (data: { location_id?: number; subject?: string; body: string }) =>
    api.post<Message>('/messaging/', {
      content: data.body ?? data.subject,
      location_id: data.location_id ?? null,
      is_announcement: true,
      recipient_ids: [],
    }).then((r) => r.data),

  markRead: (messageIds: number[]) =>
    api.post('/messaging/mark-read', { message_ids: messageIds }).then((r) => r.data),

  getUnreadCount: () =>
    api.get<{ unread_count: number }>('/messaging/unread-count').then((r) => r.data),
};

// ============================================================
// Cash Drawer
// ============================================================

export const cashDrawer = {
  open: (data: { location_id: number; starting_cash?: number; opening_amount?: number; date?: string }) =>
    api.post<CashDrawer>('/cash-drawer/', {
      location_id: data.location_id,
      opening_amount: data.opening_amount ?? data.starting_cash ?? 0,
      date: data.date ?? new Date().toISOString().split('T')[0],
    }).then((r) => r.data),

  close: (id: number, data: { actual_cash?: number; actual_closing?: number; notes?: string }) =>
    api.patch<CashDrawer>(`/cash-drawer/${id}/close`, {
      actual_closing: data.actual_closing ?? data.actual_cash ?? 0,
      notes: data.notes,
    }).then((r) => r.data),

  addExpense: (id: number, data: { category?: string; description?: string; amount: number; notes?: string }) =>
    api.post<UnexpectedExpense>(`/cash-drawer/${id}/expenses`, {
      amount: data.amount,
      category: data.category ?? data.description ?? 'Other',
      notes: data.notes,
    }).then((r) => r.data),

  setExpected: (id: number, expected_closing: number) =>
    api.patch<CashDrawer>(`/cash-drawer/${id}/expected`, { expected_closing }).then((r) => r.data),

  edit: (id: number, data: { opening_amount?: number; expected_closing?: number; actual_closing?: number; notes?: string }) =>
    api.patch<CashDrawer>(`/cash-drawer/${id}`, data).then((r) => r.data),

  getReport: (params: { location_id?: number; start_date?: string; end_date?: string }) =>
    api.get<CashDrawer[]>('/cash-drawer/', { params }).then((r) => r.data),
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

  adpPreview: (params: { period_start: string; period_end: string }) =>
    api.get('/payroll/adp-preview', { params }).then((r) => r.data),

  adpExport: (params: { period_start: string; period_end: string }) => {
    const token = localStorage.getItem('token');
    return fetch(`${api.defaults.baseURL}/payroll/adp-export?period_start=${params.period_start}&period_end=${params.period_end}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.blob()).then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `adp_payroll_${params.period_start}_${params.period_end}.csv`;
      a.click();
    });
  },
};

// ============================================================
// Dashboard
// ============================================================

export const dashboard = {
  getSummary: () =>
    api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data),

  getLocationData: (locationId: number) =>
    api.get<LocationDashboardData>(`/dashboard/location/${locationId}`).then((r) => r.data),

  getManagerDashboard: (locationId: number) =>
    api.get(`/dashboard/manager`, { params: { location_id: locationId } }).then((r) => r.data),
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
  list: (params?: { user_id?: number; action?: string; entity_type?: string; page?: number; per_page?: number }) =>
    api.get('/audit', { params }).then((r) => {
      const data = r.data as any;
      const items = data.items ?? [];
      const total = data.total ?? 0;
      const per_page = data.per_page ?? 25;
      return {
        items,
        total,
        page: data.page ?? 1,
        per_page,
        total_pages: Math.ceil(total / per_page),
      } as PaginatedResponse<AuditLog>;
    }),
};

// ============================================================
// Company Documents
// ============================================================

export const companyDocs = {
  list: () =>
    api.get('/documents/').then((r) => r.data as any[]),

  upload: (file: File, title: string, category: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    formData.append('category', category);
    return api.post('/documents/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  downloadUrl: (docId: number) =>
    `${api.defaults.baseURL}/documents/${docId}/download`,

  delete: (docId: number) =>
    api.delete(`/documents/${docId}`),
};

// ============================================================
// Forms (Onboarding)
// ============================================================

export const forms = {
  submit: (data: { form_type: string; form_data: Record<string, any> }) =>
    api.post('/forms/', data).then((r) => r.data),

  getMy: () =>
    api.get('/forms/my').then((r) => r.data as any[]),

  getAll: (params?: { form_type?: string; employee_id?: number }) =>
    api.get('/forms/', { params }).then((r) => r.data as any[]),

  getOne: (id: number) =>
    api.get(`/forms/${id}`).then((r) => r.data),

  getStatus: () =>
    api.get('/forms/status').then((r) => r.data as any[]),
};

// ============================================================
// System Settings
// ============================================================

export const systemSettings = {
  get: () =>
    api.get<{ id: number; early_clockin_minutes: number; auto_clockout_minutes: number }>('/settings').then((r) => r.data),

  update: (data: { early_clockin_minutes?: number; auto_clockout_minutes?: number }) =>
    api.patch('/settings', data).then((r) => r.data),
};

// ============================================================
// Applications (Public Job Applications)
// ============================================================

export const applications = {
  submit: (data: { name: string; email: string; phone: string; position: string; location: string; message: string }) =>
    api.post('/applications/', data).then((r) => r.data),
};

export default api;
