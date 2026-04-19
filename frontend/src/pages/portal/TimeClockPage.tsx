import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  LogIn,
  LogOut,
  Coffee,
  Pause,
  Play,
  Edit3,
  Users,
  BarChart3,
} from 'lucide-react';
import {
  format,
  startOfWeek,
  endOfWeek,
  parseISO,
  differenceInMinutes,
  isToday,
} from 'date-fns';
import toast from 'react-hot-toast';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { timeClock, users as usersApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import type { TimeClock, User } from '@/types';
import { UserRole, BreakType } from '@/types';

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatTimeStr(iso: string) {
  return format(parseISO(iso), 'h:mm a');
}

export function TimeClockPage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();
  const isManager = currentUser?.role === UserRole.MANAGER || currentUser?.role === UserRole.OWNER;

  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustingRecord, setAdjustingRecord] = useState<TimeClock | null>(null);
  const [adjustForm, setAdjustForm] = useState({
    clock_in: '',
    clock_out: '',
    notes: '',
  });
  const [teamView, setTeamView] = useState(false);
  const [page, setPage] = useState(1);

  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 0 });

  // Current user's active clock
  const { data: myRecords, isLoading: myRecordsLoading } = useQuery({
    queryKey: ['myTimeClock', currentUser?.id, format(today, 'yyyy-MM-dd')],
    queryFn: () =>
      timeClock.getRecords({
        user_id: currentUser!.id,
        start_date: format(today, 'yyyy-MM-dd'),
        end_date: format(today, 'yyyy-MM-dd'),
        per_page: 10,
      }),
    enabled: !!currentUser,
  });

  // Weekly records for current user
  const { data: weeklyRecords } = useQuery({
    queryKey: ['weeklyTimeClock', currentUser?.id, format(weekStart, 'yyyy-MM-dd')],
    queryFn: () =>
      timeClock.getRecords({
        user_id: currentUser!.id,
        start_date: format(weekStart, 'yyyy-MM-dd'),
        end_date: format(weekEnd, 'yyyy-MM-dd'),
        per_page: 50,
      }),
    enabled: !!currentUser,
  });

  // Team records for managers
  const { data: teamRecords, isLoading: teamLoading } = useQuery({
    queryKey: ['teamTimeClock', format(today, 'yyyy-MM-dd'), page],
    queryFn: () =>
      timeClock.getRecords({
        start_date: format(weekStart, 'yyyy-MM-dd'),
        end_date: format(weekEnd, 'yyyy-MM-dd'),
        page,
        per_page: 20,
      }),
    enabled: isManager && teamView,
  });

  // Find active clock (no clock_out)
  const activeClock = useMemo(() => {
    return myRecords?.items?.find((r) => !r.clock_out) ?? null;
  }, [myRecords]);

  // Active break
  const activeBreak = useMemo(() => {
    if (!activeClock) return null;
    return activeClock.breaks?.find((b) => !b.end_time) ?? null;
  }, [activeClock]);

  // Today's total
  const todayTotal = useMemo(() => {
    if (!myRecords?.items) return 0;
    return myRecords.items.reduce((sum, r) => sum + (r.total_hours ?? 0) * 60, 0);
  }, [myRecords]);

  // Weekly total
  const weeklyTotal = useMemo(() => {
    if (!weeklyRecords?.items) return 0;
    return weeklyRecords.items.reduce((sum, r) => sum + (r.total_hours ?? 0) * 60, 0);
  }, [weeklyRecords]);

  // My Hours Summary stats
  const hoursSummary = useMemo(() => {
    if (!weeklyRecords?.items) return null;
    const totalHours = weeklyRecords.items.reduce((sum, r) => sum + (r.total_hours ?? 0), 0);
    const regularHours = Math.min(totalHours, 40);
    const overtimeHours = Math.max(0, totalHours - 40);
    const shiftCount = weeklyRecords.items.filter((r) => r.clock_out).length;
    return { totalHours, regularHours, overtimeHours, shiftCount };
  }, [weeklyRecords]);

  // Mutations
  const clockInMutation = useMutation({
    mutationFn: () =>
      timeClock.clockIn({ location_id: currentUser!.primary_location_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTimeClock'] });
      queryClient.invalidateQueries({ queryKey: ['weeklyTimeClock'] });
      toast.success('Clocked in!');
    },
    onError: () => toast.error('Failed to clock in'),
  });

  const clockOutMutation = useMutation({
    mutationFn: () => timeClock.clockOut(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTimeClock'] });
      queryClient.invalidateQueries({ queryKey: ['weeklyTimeClock'] });
      toast.success('Clocked out!');
    },
    onError: () => toast.error('Failed to clock out'),
  });

  const startBreakMutation = useMutation({
    mutationFn: (breakType: string) =>
      timeClock.startBreak({ break_type: breakType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTimeClock'] });
      toast.success('Break started');
    },
    onError: () => toast.error('Failed to start break'),
  });

  const endBreakMutation = useMutation({
    mutationFn: () => timeClock.endBreak(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTimeClock'] });
      toast.success('Break ended');
    },
    onError: () => toast.error('Failed to end break'),
  });

  const adjustMutation = useMutation({
    mutationFn: () =>
      timeClock.adjustTime(adjustingRecord!.id, {
        clock_in: adjustForm.clock_in || undefined,
        clock_out: adjustForm.clock_out || undefined,
        notes: adjustForm.notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamTimeClock'] });
      queryClient.invalidateQueries({ queryKey: ['myTimeClock'] });
      setShowAdjustModal(false);
      toast.success('Time adjusted');
    },
    onError: () => toast.error('Failed to adjust time'),
  });

  const openAdjustModal = (record: TimeClock) => {
    setAdjustingRecord(record);
    setAdjustForm({
      clock_in: record.clock_in ? format(parseISO(record.clock_in), "yyyy-MM-dd'T'HH:mm") : '',
      clock_out: record.clock_out ? format(parseISO(record.clock_out), "yyyy-MM-dd'T'HH:mm") : '',
      notes: '',
    });
    setShowAdjustModal(true);
  };

  // Status display
  const getClockStatus = () => {
    if (!activeClock) return { label: 'Clocked Out', color: 'text-gray-500', bg: 'bg-gray-100' };
    if (activeBreak)
      return {
        label: `On Break (${activeBreak.break_type === BreakType.PAID ? '10 min paid' : '30 min unpaid'})`,
        color: 'text-amber-600',
        bg: 'bg-amber-50',
      };
    return { label: 'Clocked In', color: 'text-green-600', bg: 'bg-green-50' };
  };

  const status = getClockStatus();

  const teamColumns: Column<TimeClock>[] = [
    {
      key: 'user',
      header: 'Employee',
      render: (r) =>
        r.user ? `${r.user.first_name} ${r.user.last_name}` : `#${r.user_id}`,
    },
    {
      key: 'date',
      header: 'Date',
      render: (r) => format(parseISO(r.clock_in), 'MMM d'),
      sortable: true,
    },
    {
      key: 'clock_in',
      header: 'Clock In',
      render: (r) => formatTimeStr(r.clock_in),
    },
    {
      key: 'clock_out',
      header: 'Clock Out',
      render: (r) => (r.clock_out ? formatTimeStr(r.clock_out) : '--'),
    },
    {
      key: 'total_hours',
      header: 'Hours',
      render: (r) => (r.total_hours != null ? `${r.total_hours.toFixed(2)}h` : '--'),
      sortable: true,
    },
    {
      key: 'breaks',
      header: 'Breaks',
      render: (r) =>
        r.breaks?.length > 0 ? (
          <span className="text-xs">
            {r.breaks.length} break{r.breaks.length > 1 ? 's' : ''}
          </span>
        ) : (
          '--'
        ),
    },
    ...(isManager
      ? [
          {
            key: 'actions' as const,
            header: 'Actions',
            render: (r: TimeClock) => (
              <Button
                size="sm"
                variant="ghost"
                icon={<Edit3 className="h-3.5 w-3.5" />}
                onClick={() => openAdjustModal(r)}
              >
                Adjust
              </Button>
            ),
          },
        ]
      : []),
  ];

  if (myRecordsLoading) {
    return <LoadingSpinner size="lg" label="Loading time clock..." className="py-20" />;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Time Clock</h1>
          <p className="page-subtitle">Clock in, clock out, and manage your time records.</p>
        </div>
        {isManager && (
          <Button
            variant={teamView ? 'primary' : 'secondary'}
            icon={<Users className="h-4 w-4" />}
            onClick={() => setTeamView(!teamView)}
          >
            {teamView ? 'My Time' : 'Team Hours'}
          </Button>
        )}
      </div>

      {!teamView && (
        <>
          {/* Current Status Card */}
          <Card className="mb-6">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <div
                className={`flex items-center justify-center h-20 w-20 rounded-full ${status.bg}`}
              >
                <Clock className={`h-10 w-10 ${status.color}`} />
              </div>
              <div className="text-center sm:text-left flex-1">
                <p className="text-sm text-gray-500">Current Status</p>
                <p className={`text-2xl font-bold ${status.color}`}>{status.label}</p>
                {activeClock && (
                  <p className="text-sm text-gray-500 mt-1">
                    Since {formatTimeStr(activeClock.clock_in)}
                    {activeClock.clock_in && !activeClock.clock_out && (
                      <span className="ml-2">
                        ({formatDuration(differenceInMinutes(new Date(), parseISO(activeClock.clock_in)))} elapsed)
                      </span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                {!activeClock ? (
                  <Button
                    size="lg"
                    icon={<LogIn className="h-5 w-5" />}
                    onClick={() => clockInMutation.mutate()}
                    loading={clockInMutation.isPending}
                  >
                    Clock In
                  </Button>
                ) : (
                  <>
                    {activeBreak ? (
                      <Button
                        size="lg"
                        variant="secondary"
                        icon={<Play className="h-5 w-5" />}
                        onClick={() => endBreakMutation.mutate()}
                        loading={endBreakMutation.isPending}
                      >
                        End Break
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="lg"
                          variant="secondary"
                          icon={<Coffee className="h-5 w-5" />}
                          onClick={() => startBreakMutation.mutate('paid')}
                          loading={startBreakMutation.isPending}
                        >
                          10 min Break
                        </Button>
                        <Button
                          size="lg"
                          variant="secondary"
                          icon={<Pause className="h-5 w-5" />}
                          onClick={() => startBreakMutation.mutate('unpaid')}
                          loading={startBreakMutation.isPending}
                        >
                          30 min Break
                        </Button>
                      </>
                    )}
                    <Button
                      size="lg"
                      variant="danger"
                      icon={<LogOut className="h-5 w-5" />}
                      onClick={() => clockOutMutation.mutate()}
                      loading={clockOutMutation.isPending}
                    >
                      Clock Out
                    </Button>
                  </>
                )}
              </div>
            </div>
          </Card>

          {/* My Hours Summary */}
          {hoursSummary && (
            <Card className="mb-6">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-gray-900">My Hours Summary</h3>
                <span className="text-sm text-gray-500 ml-auto">
                  {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg bg-blue-50 p-4 text-center">
                  <p className="text-2xl font-bold text-blue-700">
                    {hoursSummary.totalHours.toFixed(1)}
                  </p>
                  <p className="text-xs text-blue-600 font-medium mt-1">Total Hours</p>
                </div>
                <div className="rounded-lg bg-green-50 p-4 text-center">
                  <p className="text-2xl font-bold text-green-700">
                    {hoursSummary.regularHours.toFixed(1)}
                    {hoursSummary.overtimeHours > 0 && (
                      <span className="text-sm text-amber-600 ml-1">
                        +{hoursSummary.overtimeHours.toFixed(1)} OT
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-green-600 font-medium mt-1">Regular Hours</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-700">{hoursSummary.shiftCount}</p>
                  <p className="text-xs text-gray-500 font-medium mt-1">Completed Shifts</p>
                </div>
              </div>
            </Card>
          )}

          {/* Today's Log & Weekly Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Today */}
            <Card title="Today's Time Log">
              {myRecords?.items && myRecords.items.length > 0 ? (
                <div className="space-y-3">
                  {myRecords.items.map((record) => (
                    <div
                      key={record.id}
                      className="flex items-center justify-between rounded-lg border border-gray-200 p-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {formatTimeStr(record.clock_in)}
                          {record.clock_out ? ` - ${formatTimeStr(record.clock_out)}` : ' - now'}
                        </p>
                        {record.breaks?.length > 0 && (
                          <p className="text-xs text-gray-500 mt-1">
                            {record.breaks.map((b, i) => (
                              <span key={b.id}>
                                {i > 0 ? ', ' : ''}
                                {b.break_type === BreakType.PAID ? '10m' : '30m'} break
                                {b.end_time ? '' : ' (active)'}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                      <span className="text-sm font-semibold text-gray-700">
                        {record.total_hours != null
                          ? `${record.total_hours.toFixed(2)}h`
                          : 'Active'}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-2 border-t border-gray-100">
                    <span className="text-sm font-medium text-gray-500">Today Total</span>
                    <span className="text-sm font-bold text-gray-900">
                      {formatDuration(Math.round(todayTotal))}
                    </span>
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={<Clock className="h-10 w-10" />}
                  title="No time entries today"
                  description="Clock in to start tracking your time."
                />
              )}
            </Card>

            {/* Weekly Summary */}
            <Card title="Weekly Summary">
              {weeklyRecords?.items && weeklyRecords.items.length > 0 ? (
                <div className="space-y-2">
                  {weeklyRecords.items.map((record) => (
                    <div
                      key={record.id}
                      className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                    >
                      <div>
                        <p className="text-sm text-gray-700">
                          {format(parseISO(record.clock_in), 'EEE, MMM d')}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatTimeStr(record.clock_in)}
                          {record.clock_out ? ` - ${formatTimeStr(record.clock_out)}` : ' - now'}
                        </p>
                      </div>
                      <span className="text-sm font-medium text-gray-700">
                        {record.total_hours != null
                          ? `${record.total_hours.toFixed(2)}h`
                          : 'Active'}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-3 border-t border-gray-200">
                    <span className="font-medium text-gray-700">Weekly Total</span>
                    <span className="font-bold text-gray-900">
                      {formatDuration(Math.round(weeklyTotal))}
                    </span>
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={<Clock className="h-10 w-10" />}
                  title="No entries this week"
                  description="Your weekly hours will appear here."
                />
              )}
            </Card>
          </div>
        </>
      )}

      {/* Team View (Managers) */}
      {isManager && teamView && (
        <Card title="Team Time Records" className="mt-6">
          {teamLoading ? (
            <LoadingSpinner label="Loading team records..." />
          ) : teamRecords?.items && teamRecords.items.length > 0 ? (
            <DataTable
              columns={teamColumns}
              data={teamRecords.items as unknown as Record<string, unknown>[]}
              keyExtractor={(r) => (r as unknown as TimeClock).id}
              pagination={{
                page: teamRecords.page,
                totalPages: teamRecords.total_pages,
                onPageChange: setPage,
              }}
            />
          ) : (
            <EmptyState title="No team records" description="No time records found for this period." />
          )}
        </Card>
      )}

      {/* Adjust Time Modal (Managers) */}
      <Modal
        open={showAdjustModal}
        onClose={() => setShowAdjustModal(false)}
        title="Adjust Time Record"
      >
        <div className="space-y-4">
          {adjustingRecord && (
            <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
              <p>
                Employee:{' '}
                {adjustingRecord.user
                  ? `${adjustingRecord.user.first_name} ${adjustingRecord.user.last_name}`
                  : `#${adjustingRecord.user_id}`}
              </p>
              <p>
                Original: {formatTimeStr(adjustingRecord.clock_in)}
                {adjustingRecord.clock_out && ` - ${formatTimeStr(adjustingRecord.clock_out)}`}
              </p>
            </div>
          )}
          <Input
            label="Clock In"
            type="datetime-local"
            value={adjustForm.clock_in}
            onChange={(e) => setAdjustForm({ ...adjustForm, clock_in: e.target.value })}
          />
          <Input
            label="Clock Out"
            type="datetime-local"
            value={adjustForm.clock_out}
            onChange={(e) => setAdjustForm({ ...adjustForm, clock_out: e.target.value })}
          />
          <Input
            label="Reason for Adjustment (required)"
            value={adjustForm.notes}
            onChange={(e) => setAdjustForm({ ...adjustForm, notes: e.target.value })}
            placeholder="Explain the reason for this time adjustment..."
            error={adjustForm.notes.length === 0 ? 'Notes are required for adjustments' : undefined}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowAdjustModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => adjustMutation.mutate()}
              loading={adjustMutation.isPending}
              disabled={!adjustForm.notes}
            >
              Save Adjustment
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
