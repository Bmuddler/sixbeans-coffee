import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  Clock,
  Wand2,
  Pencil,
  Trash2,
  Ban,
  Palmtree,
  CalendarDays,
  MapPin,
} from 'lucide-react';
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  addDays,
  parseISO,
  differenceInMinutes,
} from 'date-fns';
import toast from 'react-hot-toast';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { api, schedules, users, locations as locationsApi, timeOff } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import type { ScheduledShift, ShiftTemplate, User, Location, RequestStatus } from '@/types';
import { UserRole, ShiftStatus } from '@/types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBREVS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function fmtTime(time: string) {
  const [h, m] = time.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'pm' : 'am';
  const dh = hour % 12 || 12;
  return m === '00' ? `${dh}${ampm}` : `${dh}:${m}${ampm}`;
}

function shiftHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60);
}

function EmployeeScheduleView() {
  const { user: currentUser } = useAuthStore();
  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );

  const locationId = currentUser?.primary_location_id ?? currentUser?.location_ids?.[0];
  const weekEnd = addDays(currentWeekStart, 6);
  const nextWeekStart = addWeeks(currentWeekStart, 1);
  const nextWeekEnd = addDays(nextWeekStart, 6);

  const { data: locationsList } = useQuery({
    queryKey: ['locations'],
    queryFn: () => locationsApi.list(),
  });

  const locMap = useMemo(() => {
    const m = new Map<number, string>();
    locationsList?.forEach((l) => m.set(l.id, l.name));
    return m;
  }, [locationsList]);

  // Fetch current week
  const { data: thisWeekData, isLoading: loading1 } = useQuery({
    queryKey: ['my-shifts-week1', locationId, format(currentWeekStart, 'yyyy-MM-dd')],
    queryFn: () =>
      schedules.listShifts({
        location_id: locationId,
        start_date: format(currentWeekStart, 'yyyy-MM-dd'),
        end_date: format(weekEnd, 'yyyy-MM-dd'),
      }),
    enabled: !!locationId,
  });

  // Fetch next week
  const { data: nextWeekData, isLoading: loading2 } = useQuery({
    queryKey: ['my-shifts-week2', locationId, format(nextWeekStart, 'yyyy-MM-dd')],
    queryFn: () =>
      schedules.listShifts({
        location_id: locationId,
        start_date: format(nextWeekStart, 'yyyy-MM-dd'),
        end_date: format(nextWeekEnd, 'yyyy-MM-dd'),
      }),
    enabled: !!locationId,
  });

  const myShifts = useMemo(() => {
    const allShifts = [
      ...(thisWeekData?.shifts ?? []),
      ...(nextWeekData?.shifts ?? []),
    ];
    return allShifts
      .filter((s) => s.employee_id === currentUser?.id)
      .filter((s) => s.date >= format(new Date(), 'yyyy-MM-dd'))
      .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));
  }, [thisWeekData, nextWeekData, currentUser?.id]);

  const isLoading = loading1 || loading2;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Upcoming Shifts</h1>
          <p className="page-subtitle">Your scheduled shifts for the next 14 days.</p>
        </div>
      </div>

      {isLoading ? (
        <LoadingSpinner size="lg" label="Loading your shifts..." className="py-20" />
      ) : myShifts.length > 0 ? (
        <div className="space-y-3 max-w-2xl">
          {myShifts.map((shift) => {
            const shiftDate = parseISO(shift.date);
            return (
              <Card key={shift.id} className="flex items-center gap-4">
                <div className="flex items-center justify-center h-14 w-14 rounded-lg bg-blue-50 flex-shrink-0">
                  <div className="text-center">
                    <p className="text-xs font-semibold text-blue-600 uppercase">
                      {format(shiftDate, 'EEE')}
                    </p>
                    <p className="text-lg font-bold text-blue-800">{format(shiftDate, 'd')}</p>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {format(shiftDate, 'EEEE, MMMM d, yyyy')}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-sm text-gray-600">
                      <Clock className="h-3.5 w-3.5" />
                      {fmtTime(shift.start_time)} - {fmtTime(shift.end_time)}
                    </span>
                    <span className="flex items-center gap-1 text-sm text-gray-500">
                      <MapPin className="h-3.5 w-3.5" />
                      {locMap.get(shift.location_id) ?? `Location #${shift.location_id}`}
                    </span>
                  </div>
                  {shift.manager_notes && (
                    <p className="text-xs text-gray-500 italic mt-1">{shift.manager_notes}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-gray-700">
                    {shiftHours(shift.start_time, shift.end_time).toFixed(1)}h
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-12 w-12" />}
            title="No Upcoming Shifts"
            description="No upcoming shifts scheduled. Check back later or contact your manager."
          />
        </Card>
      )}
    </div>
  );
}

export function SchedulePage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();
  const isManager = currentUser?.role === UserRole.MANAGER || currentUser?.role === UserRole.OWNER;

  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [selectedLocationId, setSelectedLocationId] = useState<number | undefined>(
    currentUser?.primary_location_id ?? currentUser?.location_ids?.[0],
  );
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingShift, setEditingShift] = useState<ScheduledShift | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [shiftForm, setShiftForm] = useState({ employee_id: '', start_time: '06:00', end_time: '14:00', manager_notes: '' });
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState({ name: '', start_time: '06:00', end_time: '14:00', role_needed: '', days_of_week: [] as string[] });

  const weekEnd = addDays(currentWeekStart, 6);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  const { data: locationsList } = useQuery({ queryKey: ['locations'], queryFn: () => locationsApi.list() });
  if (!selectedLocationId && locationsList?.length) setSelectedLocationId(locationsList[0].id);

  const { data: employeeList } = useQuery({
    queryKey: ['users', selectedLocationId],
    queryFn: () => users.list({ per_page: 100, location_id: selectedLocationId }),
    enabled: !!selectedLocationId,
  });
  const { data: shiftsData, isLoading: shiftsLoading } = useQuery({
    queryKey: ['shifts', selectedLocationId, format(currentWeekStart, 'yyyy-MM-dd')],
    queryFn: () => schedules.listShifts({ location_id: selectedLocationId, start_date: format(currentWeekStart, 'yyyy-MM-dd'), end_date: format(weekEnd, 'yyyy-MM-dd') }),
    enabled: !!selectedLocationId,
  });
  const { data: templatesList } = useQuery({
    queryKey: ['shiftTemplates', selectedLocationId],
    queryFn: () => schedules.listTemplates(selectedLocationId!),
    enabled: !!selectedLocationId && isManager,
  });
  const { data: timeOffData } = useQuery({
    queryKey: ['timeOff', format(currentWeekStart, 'yyyy-MM-dd')],
    queryFn: () => timeOff.list({ status: 'approved' as RequestStatus }),
  });

  // Mutations
  const createShiftMutation = useMutation({
    mutationFn: (data: Partial<ScheduledShift>) => schedules.createShift(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shifts'] }); setShowShiftModal(false); toast.success('Shift created'); },
    onError: () => toast.error('Failed to create shift'),
  });
  const updateShiftMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => api.patch(`/schedules/shifts/${id}`, data).then((r) => r.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shifts'] }); setShowShiftModal(false); setEditingShift(null); toast.success('Shift updated'); },
    onError: () => toast.error('Failed to update shift'),
  });
  const deleteShiftMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/schedules/shifts/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shifts'] }); setShowShiftModal(false); setEditingShift(null); toast.success('Shift deleted'); },
    onError: () => toast.error('Failed to delete shift'),
  });
  const createTemplateMutation = useMutation({
    mutationFn: (data: any) => schedules.createTemplate(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shiftTemplates'] }); setShowTemplateModal(false); setEditingTemplate(null); toast.success('Template created'); },
    onError: () => toast.error('Failed to create template'),
  });
  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => api.patch(`/schedules/templates/${id}`, data).then((r) => r.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shiftTemplates'] }); setShowTemplateModal(false); setEditingTemplate(null); toast.success('Template updated'); },
    onError: () => toast.error('Failed to update template'),
  });
  const deleteTemplateMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/schedules/templates/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shiftTemplates'] }); toast.success('Template deleted'); },
    onError: () => toast.error('Failed to delete template'),
  });
  const publishMutation = useMutation({
    mutationFn: () => schedules.publishWeek({ week_start: format(currentWeekStart, 'yyyy-MM-dd'), location_id: selectedLocationId! }),
    onSuccess: (data: any) => { queryClient.invalidateQueries({ queryKey: ['shifts'] }); toast.success(`Schedule published! ${data.notified} employees notified.`); },
    onError: () => toast.error('Failed to publish schedule'),
  });
  const unpublishMutation = useMutation({
    mutationFn: () => schedules.unpublishWeek({ week_start: format(currentWeekStart, 'yyyy-MM-dd'), location_id: selectedLocationId! }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shifts'] }); toast.success('Schedule unpublished — back to draft'); },
    onError: () => toast.error('Failed to unpublish'),
  });
  const copyWeekMutation = useMutation({
    mutationFn: () => schedules.copyWeek({ location_id: selectedLocationId!, source_week_start: format(subWeeks(currentWeekStart, 1), 'yyyy-MM-dd'), target_week_start: format(currentWeekStart, 'yyyy-MM-dd') }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shifts'] }); toast.success('Previous week copied'); },
    onError: () => toast.error('Failed to copy week'),
  });
  const generateMutation = useMutation({
    mutationFn: () => api.post(`/schedules/generate-from-templates?week_start=${format(currentWeekStart, 'yyyy-MM-dd')}&location_id=${selectedLocationId}`).then((r) => r.data),
    onSuccess: (data: any) => { queryClient.invalidateQueries({ queryKey: ['shifts'] }); toast.success(`Generated ${data.total} shifts from templates`); },
    onError: () => toast.error('Failed to generate shifts'),
  });

  const allEmployees = employeeList?.items || [];

  // Build schedule grid data
  const gridData = useMemo(() => {
    const empMap = new Map<number, { employee: User; shifts: Map<string, ScheduledShift[]>; totalHours: number }>();

    allEmployees.forEach((emp) => {
      const shifts = new Map<string, ScheduledShift[]>();
      weekDays.forEach((d) => shifts.set(format(d, 'yyyy-MM-dd'), []));
      empMap.set(emp.id, { employee: emp, shifts, totalHours: 0 });
    });

    // Unassigned shifts
    const openShifts = new Map<string, ScheduledShift[]>();
    weekDays.forEach((d) => openShifts.set(format(d, 'yyyy-MM-dd'), []));

    let totalOpenCount = 0;
    shiftsData?.shifts?.forEach((shift) => {
      if (shift.employee_id && empMap.has(shift.employee_id)) {
        const entry = empMap.get(shift.employee_id)!;
        const dayShifts = entry.shifts.get(shift.date) || [];
        dayShifts.push(shift);
        entry.shifts.set(shift.date, dayShifts);
        entry.totalHours += shiftHours(shift.start_time, shift.end_time);
      } else {
        const dayShifts = openShifts.get(shift.date) || [];
        dayShifts.push(shift);
        openShifts.set(shift.date, dayShifts);
        totalOpenCount++;
      }
    });

    // Daily totals
    const dailyHours = weekDays.map((d) => {
      const dateKey = format(d, 'yyyy-MM-dd');
      let hours = 0;
      shiftsData?.shifts?.forEach((s) => { if (s.date === dateKey) hours += shiftHours(s.start_time, s.end_time); });
      return hours;
    });

    return { empMap, openShifts, totalOpenCount, dailyHours };
  }, [allEmployees, shiftsData, weekDays]);

  const getUnavailReasons = (userId: number, dateKey: string): string[] => {
    const unavail = shiftsData?.unavailable?.[dateKey];
    if (!unavail) return [];
    return unavail[String(userId)] ?? [];
  };

  const hasTimeOff = (userId: number, dateKey: string) => {
    return getUnavailReasons(userId, dateKey).length > 0;
  };

  // Handlers
  const handleCellClick = (empId: number, day: Date) => {
    if (!isManager) return;
    setSelectedDay(day);
    setSelectedEmployeeId(empId);
    setEditingShift(null);
    setShiftForm({ employee_id: String(empId), start_time: '06:00', end_time: '14:00', manager_notes: '' });
    setShowShiftModal(true);
  };

  const handleEditShift = (shift: ScheduledShift) => {
    if (!isManager) return;
    setEditingShift(shift);
    setSelectedDay(parseISO(shift.date));
    setSelectedEmployeeId(shift.employee_id ?? null);
    setShiftForm({
      employee_id: String(shift.employee_id ?? ''),
      start_time: shift.start_time?.slice(0, 5) ?? '06:00',
      end_time: shift.end_time?.slice(0, 5) ?? '14:00',
      manager_notes: shift.manager_notes ?? '',
    });
    setShowShiftModal(true);
  };

  const handleSubmitShift = () => {
    if (!selectedDay || !selectedLocationId) return;
    if (editingShift) {
      updateShiftMutation.mutate({ id: editingShift.id, data: { employee_id: shiftForm.employee_id ? Number(shiftForm.employee_id) : null, start_time: shiftForm.start_time, end_time: shiftForm.end_time, manager_notes: shiftForm.manager_notes || null } });
    } else {
      createShiftMutation.mutate({ location_id: selectedLocationId, employee_id: shiftForm.employee_id ? Number(shiftForm.employee_id) : undefined, date: format(selectedDay, 'yyyy-MM-dd'), start_time: shiftForm.start_time, end_time: shiftForm.end_time, manager_notes: shiftForm.manager_notes || undefined });
    }
  };

  const handleAddTemplate = () => { setEditingTemplate(null); setTemplateForm({ name: '', start_time: '06:00', end_time: '14:00', role_needed: '', days_of_week: [] }); setShowTemplateModal(true); };
  const handleEditTemplate = (tmpl: any) => {
    setEditingTemplate(tmpl);
    setTemplateForm({ name: tmpl.name, start_time: tmpl.start_time?.slice(0, 5) ?? '06:00', end_time: tmpl.end_time?.slice(0, 5) ?? '14:00', role_needed: tmpl.role_needed ?? '', days_of_week: tmpl.days_of_week ? tmpl.days_of_week.split(',').map((d: string) => d.trim().toLowerCase()) : [] });
    setShowTemplateModal(true);
  };
  const toggleDay = (day: string) => setTemplateForm((p) => ({ ...p, days_of_week: p.days_of_week.includes(day) ? p.days_of_week.filter((d) => d !== day) : [...p.days_of_week, day] }));
  const handleSubmitTemplate = () => {
    if (!selectedLocationId || !templateForm.name) return;
    const payload = { location_id: selectedLocationId, name: templateForm.name, start_time: templateForm.start_time, end_time: templateForm.end_time, role_needed: templateForm.role_needed || null, days_of_week: templateForm.days_of_week.length > 0 ? templateForm.days_of_week.join(',') : null };
    if (editingTemplate) updateTemplateMutation.mutate({ id: editingTemplate.id, data: payload });
    else createTemplateMutation.mutate(payload);
  };

  const totalWeekHours = gridData.dailyHours.reduce((a, b) => a + b, 0);

  // Employees see a simpler "My Shifts" view
  if (!isManager) {
    return <EmployeeScheduleView />;
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Schedule</h1>
          <p className="page-subtitle">View and manage weekly schedules.</p>
        </div>
        {isManager && (
          <div className="flex flex-wrap items-center gap-2">
            {shiftsData?.week_status === 'published' ? (
              <Button variant="secondary" size="sm" onClick={() => unpublishMutation.mutate()} loading={unpublishMutation.isPending}>Unpublish (Back to Draft)</Button>
            ) : (
              <Button size="sm" style={{ backgroundColor: '#2D5016' }} className="text-white" onClick={() => publishMutation.mutate()} loading={publishMutation.isPending} disabled={!shiftsData?.shifts?.length}>
                Publish & Notify Team
              </Button>
            )}
            <Button variant="secondary" size="sm" icon={<Wand2 className="h-4 w-4" />} onClick={() => generateMutation.mutate()} loading={generateMutation.isPending} disabled={!templatesList?.length}>Generate from Templates</Button>
            <Button variant="secondary" size="sm" icon={<Copy className="h-4 w-4" />} onClick={() => copyWeekMutation.mutate()} loading={copyWeekMutation.isPending}>Copy Previous Week</Button>
          </div>
        )}
      </div>

      {/* Week Nav & Location */}
      <Card className="mb-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setCurrentWeekStart(subWeeks(currentWeekStart, 1))} icon={<ChevronLeft className="h-4 w-4" />}>Prev</Button>
            <h2 className="text-lg font-semibold text-gray-900 whitespace-nowrap">{format(currentWeekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}</h2>
            <Button variant="ghost" size="sm" onClick={() => setCurrentWeekStart(addWeeks(currentWeekStart, 1))}>Next <ChevronRight className="h-4 w-4" /></Button>
          </div>
          {locationsList && locationsList.length > 1 && (
            <Select options={locationsList.map((l: Location) => ({ value: l.id, label: l.name }))} value={selectedLocationId ?? ''} onChange={(e) => setSelectedLocationId(Number(e.target.value))} placeholder="Select location" />
          )}
        </div>
      </Card>

      {/* Draft/Published Status Banner */}
      {shiftsData && (
        <div className={`mb-4 rounded-lg border px-4 py-2 flex items-center justify-between ${shiftsData.week_status === 'published' ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${shiftsData.week_status === 'published' ? 'bg-green-500' : 'bg-amber-500'}`} />
            <span className={`text-sm font-medium ${shiftsData.week_status === 'published' ? 'text-green-800' : 'text-amber-800'}`}>
              {shiftsData.week_status === 'published' ? 'Published — employees can see this schedule' : 'Draft — only managers can see. Publish when ready.'}
            </span>
          </div>
          {shiftsData.published_at && (
            <span className="text-xs text-green-600">Published {new Date(shiftsData.published_at + 'Z').toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          )}
        </div>
      )}

      {/* Schedule Grid — Employee Rows */}
      {shiftsLoading ? (
        <LoadingSpinner size="lg" label="Loading schedule..." className="py-20" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 min-w-[200px]">Team Member</th>
                {weekDays.map((day) => (
                  <th key={format(day, 'yyyy-MM-dd')} className="px-2 py-3 text-center text-xs font-semibold uppercase text-gray-500 min-w-[120px]">
                    <div>{DAY_NAMES[day.getDay()]}</div>
                    <div className="text-sm font-bold text-gray-900">{format(day, 'd')}</div>
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500 min-w-[80px]">Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {/* Open/Unassigned Shifts Row */}
              <tr className="bg-amber-50/50">
                <td className="sticky left-0 z-10 bg-amber-50/50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center"><Clock className="h-4 w-4 text-amber-600" /></div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Open Shifts</p>
                      <p className="text-xs text-gray-500">{gridData.totalOpenCount} unassigned</p>
                    </div>
                  </div>
                </td>
                {weekDays.map((day) => {
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const dayOpen = gridData.openShifts.get(dateKey) || [];
                  return (
                    <td key={dateKey} className="px-2 py-2 align-top">
                      <div className="space-y-1">
                        {dayOpen.map((s) => (
                          <div key={s.id} onClick={() => handleEditShift(s)} className="rounded px-1.5 py-1 text-[11px] bg-amber-100 border border-amber-200 text-amber-800 cursor-pointer hover:ring-1 hover:ring-amber-400">
                            {fmtTime(s.start_time)}-{fmtTime(s.end_time)}
                          </div>
                        ))}
                        {isManager && (
                          <button onClick={() => { setSelectedDay(day); setSelectedEmployeeId(null); setEditingShift(null); setShiftForm({ employee_id: '', start_time: '06:00', end_time: '14:00', manager_notes: '' }); setShowShiftModal(true); }} className="w-full rounded border border-dashed border-amber-300 py-0.5 text-[10px] text-amber-400 hover:text-amber-600 hover:border-amber-400">
                            <Plus className="h-2.5 w-2.5 inline" />
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-right text-sm font-medium text-gray-500">—</td>
              </tr>

              {/* Employee Rows */}
              {Array.from(gridData.empMap.values()).map(({ employee: emp, shifts, totalHours }) => (
                <tr key={emp.id} className="hover:bg-gray-50/50 group">
                  <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50/50 px-4 py-3 border-r border-gray-100">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{emp.first_name} {emp.last_name}</p>
                      <p className="text-xs text-gray-500">{totalHours.toFixed(1)} hrs</p>
                    </div>
                  </td>
                  {weekDays.map((day) => {
                    const dateKey = format(day, 'yyyy-MM-dd');
                    const dayShifts = shifts.get(dateKey) || [];
                    const isOff = hasTimeOff(emp.id, dateKey);

                    return (
                      <td key={dateKey} className={`px-2 py-2 align-top ${isOff ? 'bg-gray-100/50' : ''}`} onClick={() => dayShifts.length === 0 && !isOff && handleCellClick(emp.id, day)}>
                        <div className="space-y-1 min-h-[32px]">
                          {isOff && (
                            <div className="rounded px-1.5 py-1 text-[11px] bg-purple-50 border border-purple-200 text-purple-600" title={getUnavailReasons(emp.id, dateKey).join('\n')}>
                              <div className="flex items-center gap-1"><Palmtree className="h-3 w-3" /> Unavailable</div>
                              <div className="text-[9px] text-purple-400 truncate">{getUnavailReasons(emp.id, dateKey)[0]?.replace('Time off: ', '').replace('Unavailable: ', '')}</div>
                            </div>
                          )}
                          {dayShifts.map((s) => (
                            <div key={s.id} onClick={(e) => { e.stopPropagation(); handleEditShift(s); }} className="rounded px-1.5 py-1 text-[11px] bg-blue-50 border border-blue-200 text-blue-800 cursor-pointer hover:ring-1 hover:ring-blue-400 transition-all">
                              <div className="font-medium">{fmtTime(s.start_time)}-{fmtTime(s.end_time)}</div>
                              {s.manager_notes && <div className="text-[10px] text-blue-600 italic truncate">{s.manager_notes}</div>}
                            </div>
                          ))}
                          {dayShifts.length === 0 && !isOff && isManager && (
                            <div className="h-8 rounded border border-dashed border-gray-200 flex items-center justify-center text-gray-300 hover:border-primary hover:text-primary cursor-pointer transition-colors">
                              <Plus className="h-3 w-3" />
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right border-l border-gray-100">
                    <p className="text-sm font-bold text-gray-900">{totalHours.toFixed(1)}</p>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Footer — Daily Totals */}
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-900">Totals</td>
                {gridData.dailyHours.map((hours, i) => (
                  <td key={i} className="px-2 py-3 text-center text-sm font-bold text-gray-900">{hours.toFixed(1)}</td>
                ))}
                <td className="px-4 py-3 text-right text-sm font-bold text-primary">{totalWeekHours.toFixed(1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Shift Templates */}
      {isManager && (
        <Card title="Shift Templates" className="mt-6" actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={handleAddTemplate}>Add Template</Button>}>
          {templatesList && templatesList.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {templatesList.map((tmpl: any) => (
                <div key={tmpl.id} className="rounded-lg border border-gray-200 p-3 group hover:border-primary/30 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm text-gray-900">{tmpl.name}</p>
                      <p className="text-xs text-gray-500 mt-1"><Clock className="h-3 w-3 inline mr-1" />{fmtTime(tmpl.start_time)} - {fmtTime(tmpl.end_time)}</p>
                      {tmpl.role_needed && <Badge variant="info" className="mt-1">{tmpl.role_needed}</Badge>}
                      <p className="text-xs text-gray-400 mt-1">{tmpl.days_of_week ? tmpl.days_of_week.split(',').map((d: string) => d.trim().charAt(0).toUpperCase() + d.trim().slice(1)).join(', ') : 'Every day'}</p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEditTemplate(tmpl)} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => { if (confirm('Delete this template?')) deleteTemplateMutation.mutate(tmpl.id); }} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-4 text-center">No templates yet. Create templates to quickly generate weekly schedules.</p>
          )}
        </Card>
      )}

      {/* Add/Edit Shift Modal */}
      <Modal open={showShiftModal} onClose={() => { setShowShiftModal(false); setEditingShift(null); }} title={`${editingShift ? 'Edit' : 'Add'} Shift${selectedDay ? ` — ${format(selectedDay, 'EEEE, MMM d')}` : ''}`}>
        <div className="space-y-4">
          <Select label="Employee" options={[{ value: '', label: 'Unassigned (Open Shift)' }, ...allEmployees.map((u: User) => ({ value: u.id, label: `${u.first_name} ${u.last_name}` }))]} value={shiftForm.employee_id} onChange={(e) => setShiftForm({ ...shiftForm, employee_id: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start Time" type="time" value={shiftForm.start_time} onChange={(e) => setShiftForm({ ...shiftForm, start_time: e.target.value })} />
            <Input label="End Time" type="time" value={shiftForm.end_time} onChange={(e) => setShiftForm({ ...shiftForm, end_time: e.target.value })} />
          </div>
          <Input label="Notes (optional)" value={shiftForm.manager_notes} onChange={(e) => setShiftForm({ ...shiftForm, manager_notes: e.target.value })} placeholder="Shift notes..." />
          <div className="flex justify-between pt-2">
            <div>{editingShift && <Button variant="danger" onClick={() => deleteShiftMutation.mutate(editingShift.id)} loading={deleteShiftMutation.isPending}>Delete</Button>}</div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setShowShiftModal(false); setEditingShift(null); }}>Cancel</Button>
              <Button onClick={handleSubmitShift} loading={createShiftMutation.isPending || updateShiftMutation.isPending}>{editingShift ? 'Save Changes' : 'Create Shift'}</Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Template Modal */}
      <Modal open={showTemplateModal} onClose={() => { setShowTemplateModal(false); setEditingTemplate(null); }} title={editingTemplate ? 'Edit Template' : 'Create Shift Template'}>
        <div className="space-y-4">
          <Input label="Template Name" value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} placeholder="e.g., Opener, Closer" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start Time" type="time" value={templateForm.start_time} onChange={(e) => setTemplateForm({ ...templateForm, start_time: e.target.value })} />
            <Input label="End Time" type="time" value={templateForm.end_time} onChange={(e) => setTemplateForm({ ...templateForm, end_time: e.target.value })} />
          </div>
          <Input label="Role (optional)" value={templateForm.role_needed} onChange={(e) => setTemplateForm({ ...templateForm, role_needed: e.target.value })} placeholder="e.g., Barista, Lead" />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Days (blank = every day)</label>
            <div className="flex flex-wrap gap-2">
              {DAY_ABBREVS.map((day, i) => (
                <button key={day} type="button" onClick={() => toggleDay(day)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${templateForm.days_of_week.includes(day) ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-300 hover:border-primary'}`}>{DAY_NAMES_FULL[i]}</button>
              ))}
            </div>
          </div>
          <div className="flex justify-between pt-2">
            <div>{editingTemplate && <Button variant="danger" onClick={() => { deleteTemplateMutation.mutate(editingTemplate.id); setShowTemplateModal(false); setEditingTemplate(null); }}>Delete</Button>}</div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setShowTemplateModal(false); setEditingTemplate(null); }}>Cancel</Button>
              <Button onClick={handleSubmitTemplate} loading={createTemplateMutation.isPending || updateTemplateMutation.isPending} disabled={!templateForm.name}>{editingTemplate ? 'Save Changes' : 'Create Template'}</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
