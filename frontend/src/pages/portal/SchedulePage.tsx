import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  Users,
  Clock,
  AlertCircle,
} from 'lucide-react';
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  addDays,
  parseISO,
  isSameDay,
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

function formatTime(time: string) {
  const [h, m] = time.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${m} ${ampm}`;
}

export function SchedulePage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();
  const isManager = currentUser?.role === UserRole.MANAGER || currentUser?.role === UserRole.OWNER;

  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 0 }),
  );
  const [selectedLocationId, setSelectedLocationId] = useState<number | undefined>(
    currentUser?.primary_location_id,
  );
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);

  // Shift form state
  const [shiftForm, setShiftForm] = useState({
    employee_id: '',
    start_time: '06:00',
    end_time: '14:00',
    role_label: '',
    manager_notes: '',
  });
  const [editingShift, setEditingShift] = useState<ScheduledShift | null>(null);

  // Template form state
  const [templateForm, setTemplateForm] = useState({
    name: '',
    day_of_week: '1',
    start_time: '06:00',
    end_time: '14:00',
    role_label: '',
    min_staff: '1',
  });

  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 0 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  // Queries
  const { data: locationsList } = useQuery({
    queryKey: ['locations'],
    queryFn: () => locationsApi.list(),
  });

  const { data: employeeList } = useQuery({
    queryKey: ['users', selectedLocationId],
    queryFn: () => users.list({ per_page: 100, location_id: selectedLocationId }),
  });

  const {
    data: shiftsData,
    isLoading: shiftsLoading,
  } = useQuery({
    queryKey: ['shifts', selectedLocationId, format(currentWeekStart, 'yyyy-MM-dd')],
    queryFn: () =>
      schedules.listShifts({
        location_id: selectedLocationId,
        start_date: format(currentWeekStart, 'yyyy-MM-dd'),
        end_date: format(weekEnd, 'yyyy-MM-dd'),
      }),
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setShowShiftModal(false);
      toast.success('Shift created');
    },
    onError: () => toast.error('Failed to create shift'),
  });

  const updateShiftMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      api.patch(`/schedules/shifts/${id}`, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setShowShiftModal(false);
      setEditingShift(null);
      toast.success('Shift updated');
    },
    onError: () => toast.error('Failed to update shift'),
  });

  const deleteShiftMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/schedules/shifts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setShowShiftModal(false);
      setEditingShift(null);
      toast.success('Shift deleted');
    },
    onError: () => toast.error('Failed to delete shift'),
  });

  const createTemplateMutation = useMutation({
    mutationFn: (data: Partial<ShiftTemplate>) => schedules.createTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shiftTemplates'] });
      setShowTemplateModal(false);
      toast.success('Template saved');
    },
    onError: () => toast.error('Failed to save template'),
  });

  const copyWeekMutation = useMutation({
    mutationFn: () =>
      schedules.copyWeek({
        location_id: selectedLocationId!,
        source_week_start: format(subWeeks(currentWeekStart, 1), 'yyyy-MM-dd'),
        target_week_start: format(currentWeekStart, 'yyyy-MM-dd'),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Previous week copied');
    },
    onError: () => toast.error('Failed to copy week'),
  });

  // Group shifts by day
  const shiftsByDay = useMemo(() => {
    const map = new Map<string, ScheduledShift[]>();
    weekDays.forEach((d) => {
      map.set(format(d, 'yyyy-MM-dd'), []);
    });
    shiftsData?.forEach((shift) => {
      const dateKey = shift.date;
      const existing = map.get(dateKey) || [];
      existing.push(shift);
      map.set(dateKey, existing);
    });
    return map;
  }, [shiftsData, weekDays]);

  // Check if a user has approved time off on a given date
  const hasTimeOff = (userId: number, date: Date) => {
    return timeOffData?.items?.some(
      (req) =>
        req.user_id === userId &&
        parseISO(req.start_date) <= date &&
        parseISO(req.end_date) >= date,
    );
  };

  const handleAddShift = (day: Date) => {
    setSelectedDay(day);
    setEditingShift(null);
    setShiftForm({ employee_id: '', start_time: '06:00', end_time: '14:00', role_label: '', manager_notes: '' });
    setShowShiftModal(true);
  };

  const handleEditShift = (shift: ScheduledShift) => {
    setEditingShift(shift);
    setSelectedDay(parseISO(shift.date));
    setShiftForm({
      employee_id: String(shift.employee_id ?? ''),
      start_time: shift.start_time?.slice(0, 5) ?? '06:00',
      end_time: shift.end_time?.slice(0, 5) ?? '14:00',
      role_label: shift.role_label ?? '',
      manager_notes: shift.manager_notes ?? '',
    });
    setShowShiftModal(true);
  };

  const handleSubmitShift = () => {
    if (!selectedDay || !selectedLocationId) return;

    if (editingShift) {
      updateShiftMutation.mutate({
        id: editingShift.id,
        data: {
          employee_id: shiftForm.employee_id ? Number(shiftForm.employee_id) : null,
          start_time: shiftForm.start_time,
          end_time: shiftForm.end_time,
          manager_notes: shiftForm.manager_notes || null,
        },
      });
      return;
    }

    createShiftMutation.mutate({
      location_id: selectedLocationId,
      employee_id: shiftForm.employee_id ? Number(shiftForm.employee_id) : undefined,
      date: format(selectedDay, 'yyyy-MM-dd'),
      start_time: shiftForm.start_time,
      end_time: shiftForm.end_time,
      manager_notes: shiftForm.manager_notes || undefined,
    });
  };

  const handleSubmitTemplate = () => {
    if (!selectedLocationId) return;
    createTemplateMutation.mutate({
      location_id: selectedLocationId,
      name: templateForm.name,
      day_of_week: Number(templateForm.day_of_week),
      start_time: templateForm.start_time,
      end_time: templateForm.end_time,
      role_label: templateForm.role_label || undefined,
      min_staff: Number(templateForm.min_staff),
    });
  };

  const getShiftStatusColor = (status: ShiftStatus) => {
    switch (status) {
      case ShiftStatus.SCHEDULED:
        return 'bg-blue-100 border-blue-300 text-blue-800';
      case ShiftStatus.IN_PROGRESS:
        return 'bg-green-100 border-green-300 text-green-800';
      case ShiftStatus.COMPLETED:
        return 'bg-gray-100 border-gray-300 text-gray-600';
      case ShiftStatus.MISSED:
        return 'bg-red-100 border-red-300 text-red-800';
      case ShiftStatus.CANCELLED:
        return 'bg-gray-50 border-gray-200 text-gray-400 line-through';
      default:
        return 'bg-blue-100 border-blue-300 text-blue-800';
    }
  };

  const employees = employeeList?.items || [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Schedule</h1>
          <p className="page-subtitle">View and manage weekly schedules.</p>
        </div>
        {isManager && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<Copy className="h-4 w-4" />}
              onClick={() => copyWeekMutation.mutate()}
              loading={copyWeekMutation.isPending}
            >
              Copy Previous Week
            </Button>
            <Button
              variant="secondary"
              icon={<Calendar className="h-4 w-4" />}
              onClick={() => {
                setEditingTemplate(null);
                setTemplateForm({
                  name: '',
                  day_of_week: '1',
                  start_time: '06:00',
                  end_time: '14:00',
                  role_label: '',
                  min_staff: '1',
                });
                setShowTemplateModal(true);
              }}
            >
              Manage Templates
            </Button>
          </div>
        )}
      </div>

      {/* Week Navigation & Filters */}
      <Card className="mb-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentWeekStart(subWeeks(currentWeekStart, 1))}
              icon={<ChevronLeft className="h-4 w-4" />}
            >
              Prev
            </Button>
            <h2 className="text-lg font-semibold text-gray-900 whitespace-nowrap">
              {format(currentWeekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentWeekStart(addWeeks(currentWeekStart, 1))}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {isManager && locationsList && locationsList.length > 1 && (
            <Select
              options={locationsList.map((l: Location) => ({ value: l.id, label: l.name }))}
              value={selectedLocationId ?? ''}
              onChange={(e) => setSelectedLocationId(Number(e.target.value))}
              placeholder="Select location"
            />
          )}
        </div>
      </Card>

      {/* Schedule Grid */}
      {shiftsLoading ? (
        <LoadingSpinner size="lg" label="Loading schedule..." className="py-20" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          {weekDays.map((day) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const dayShifts = shiftsByDay.get(dateKey) || [];
            const isToday = isSameDay(day, new Date());

            return (
              <div
                key={dateKey}
                className={`rounded-xl border ${
                  isToday ? 'border-primary bg-primary/5' : 'border-gray-200 bg-white'
                } shadow-sm overflow-hidden`}
              >
                {/* Day header */}
                <div
                  className={`px-3 py-2 text-center border-b ${
                    isToday
                      ? 'bg-primary text-white border-primary'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <p className="text-xs font-medium uppercase">
                    {DAY_NAMES[day.getDay()]}
                  </p>
                  <p className="text-lg font-bold">{format(day, 'd')}</p>
                </div>

                {/* Shifts */}
                <div className="p-2 space-y-2 min-h-[120px]">
                  {dayShifts.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-4">No shifts</p>
                  ) : (
                    dayShifts.map((shift) => (
                      <div
                        key={shift.id}
                        className={`rounded-lg border px-2 py-1.5 text-xs cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all ${getShiftStatusColor(shift.status)}`}
                        onClick={() => isManager && handleEditShift(shift)}
                      >
                        <p className="font-semibold truncate">
                          {shift.employee_name
                            ?? (shift.user
                              ? `${shift.user.first_name} ${shift.user.last_name}`
                              : shift.employee_id
                                ? `Employee #${shift.employee_id}`
                                : 'Unassigned')}
                        </p>
                        <p className="flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                        </p>
                        {shift.role_label && (
                          <p className="text-[10px] mt-0.5 opacity-75">{shift.role_label}</p>
                        )}
                        {shift.manager_notes && (
                          <p className="text-[10px] mt-0.5 italic opacity-75 truncate">
                            {shift.manager_notes}
                          </p>
                        )}
                      </div>
                    ))
                  )}

                  {/* Add shift button */}
                  {isManager && (
                    <button
                      onClick={() => handleAddShift(day)}
                      className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-xs text-gray-400 hover:border-primary hover:text-primary transition-colors"
                    >
                      <Plus className="h-3 w-3 inline mr-1" />
                      Add Shift
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Template List (managers) */}
      {isManager && templatesList && templatesList.length > 0 && (
        <Card title="Shift Templates" className="mt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templatesList.map((tmpl) => (
              <div
                key={tmpl.id}
                className="rounded-lg border border-gray-200 p-3 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-sm text-gray-900">{tmpl.name}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {DAY_NAMES_FULL[tmpl.day_of_week]} | {formatTime(tmpl.start_time)} -{' '}
                  {formatTime(tmpl.end_time)}
                </p>
                {tmpl.role_label && (
                  <Badge variant="info" className="mt-1">{tmpl.role_label}</Badge>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  <Users className="h-3 w-3 inline mr-1" />
                  Min staff: {tmpl.min_staff}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Add/Edit Shift Modal */}
      <Modal
        open={showShiftModal}
        onClose={() => { setShowShiftModal(false); setEditingShift(null); }}
        title={`${editingShift ? 'Edit' : 'Add'} Shift - ${selectedDay ? format(selectedDay, 'EEEE, MMM d') : ''}`}
      >
        <div className="space-y-4">
          <Select
            label="Employee"
            options={[
              { value: '', label: 'Unassigned' },
              ...employees.map((u: User) => ({
                value: u.id,
                label: `${u.first_name} ${u.last_name}${
                  selectedDay && hasTimeOff(u.id, selectedDay)
                    ? ' (has time off)'
                    : ''
                }`,
              })),
            ]}
            value={shiftForm.employee_id}
            onChange={(e) => setShiftForm({ ...shiftForm, employee_id: e.target.value })}
            placeholder="Select employee"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Start Time"
              type="time"
              value={shiftForm.start_time}
              onChange={(e) => setShiftForm({ ...shiftForm, start_time: e.target.value })}
            />
            <Input
              label="End Time"
              type="time"
              value={shiftForm.end_time}
              onChange={(e) => setShiftForm({ ...shiftForm, end_time: e.target.value })}
            />
          </div>
          <Input
            label="Notes (optional)"
            value={shiftForm.manager_notes}
            onChange={(e) => setShiftForm({ ...shiftForm, manager_notes: e.target.value })}
            placeholder="Shift notes..."
          />
          <div className="flex justify-between pt-2">
            <div>
              {editingShift && (
                <Button
                  variant="danger"
                  onClick={() => deleteShiftMutation.mutate(editingShift.id)}
                  loading={deleteShiftMutation.isPending}
                >
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setShowShiftModal(false); setEditingShift(null); }}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmitShift}
                loading={createShiftMutation.isPending || updateShiftMutation.isPending}
              >
                {editingShift ? 'Save Changes' : 'Create Shift'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Template Modal */}
      <Modal
        open={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        title={editingTemplate ? 'Edit Template' : 'Create Shift Template'}
      >
        <div className="space-y-4">
          <Input
            label="Template Name"
            value={templateForm.name}
            onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
            placeholder="e.g., Morning Open"
          />
          <Select
            label="Day of Week"
            options={DAY_NAMES_FULL.map((name, i) => ({ value: i, label: name }))}
            value={templateForm.day_of_week}
            onChange={(e) => setTemplateForm({ ...templateForm, day_of_week: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Start Time"
              type="time"
              value={templateForm.start_time}
              onChange={(e) => setTemplateForm({ ...templateForm, start_time: e.target.value })}
            />
            <Input
              label="End Time"
              type="time"
              value={templateForm.end_time}
              onChange={(e) => setTemplateForm({ ...templateForm, end_time: e.target.value })}
            />
          </div>
          <Input
            label="Role Label (optional)"
            value={templateForm.role_label}
            onChange={(e) => setTemplateForm({ ...templateForm, role_label: e.target.value })}
            placeholder="e.g., Barista"
          />
          <Input
            label="Minimum Staff"
            type="number"
            min="1"
            value={templateForm.min_staff}
            onChange={(e) => setTemplateForm({ ...templateForm, min_staff: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowTemplateModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitTemplate}
              loading={createTemplateMutation.isPending}
              disabled={!templateForm.name}
            >
              Save Template
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
