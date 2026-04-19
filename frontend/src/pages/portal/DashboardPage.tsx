import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Users,
  Clock,
  Calendar,
  AlertCircle,
  MapPin,
  DollarSign,
  TrendingUp,
  Bell,
  ArrowRight,
  CheckCircle2,
  XCircle,
  FileText,
  CreditCard,
  ShieldCheck,
  Phone,
  Coffee,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  dashboard,
  locations as locationsApi,
  schedules,
  timeClock,
  timeOff,
  shiftSwaps,
  shiftCoverage,
  cashDrawer,
  messages as messagesApi,
} from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { formatTime as formatTimeTz } from '@/lib/timezone';
import { UserRole, type ScheduledShift, type LocationDashboardData } from '@/types';

function ensureUtc(s: string) {
  return s && !s.endsWith('Z') && !s.includes('+') && !s.includes('-', 10) ? s + 'Z' : s;
}

function formatTime(timeStr: string) {
  return new Date(ensureUtc(timeStr)).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
}

function formatDate(dateStr: string) {
  return new Date(ensureUtc(dateStr)).toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function getWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - dayOfWeek);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    start_date: start.toISOString().split('T')[0],
    end_date: end.toISOString().split('T')[0],
  };
}

const today = new Date().toISOString().split('T')[0];

// ============================================================
// Employee Dashboard Section
// ============================================================

function EmployeeDashboard({ userId, locationId }: { userId: number; locationId: number }) {
  const queryClient = useQueryClient();
  const week = getWeekRange();

  const { data: myShifts, isLoading: shiftsLoading } = useQuery({
    queryKey: ['my-shifts', week],
    queryFn: () =>
      schedules.listShifts({
        user_id: userId,
        start_date: week.start_date,
        end_date: week.end_date,
      }),
  });

  const { data: clockRecords } = useQuery({
    queryKey: ['my-clock', today],
    queryFn: () =>
      timeClock.getRecords({
        user_id: userId,
        start_date: today,
        end_date: today,
      }),
  });

  const { data: myTimeOff } = useQuery({
    queryKey: ['my-time-off-pending'],
    queryFn: () => timeOff.list({ user_id: userId, status: 'pending' as never }),
  });

  const { data: mySwaps } = useQuery({
    queryKey: ['my-swaps-pending'],
    queryFn: () => shiftSwaps.list({ status: 'pending' as never }),
  });

  const { data: announcements } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => messagesApi.getAnnouncements({ location_id: locationId }),
    refetchInterval: 60000,
  });

  const activeClock = clockRecords?.items?.find((c) => !c.clock_out);

  const clockInMutation = useMutation({
    mutationFn: () => timeClock.clockIn({ location_id: locationId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-clock'] }),
  });

  const clockOutMutation = useMutation({
    mutationFn: (id: number) => timeClock.clockOut(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-clock'] }),
  });

  const todayShifts = myShifts?.filter((s) => s.date === today) ?? [];
  const upcomingShifts = myShifts?.filter((s) => s.date > today).slice(0, 5) ?? [];
  const pendingTimeOff = myTimeOff?.items?.length ?? 0;
  const pendingSwaps = mySwaps?.items?.filter(
    (s) => s.requester_id === userId || s.target_id === userId
  ).length ?? 0;

  return (
    <>
      {/* Today's Shift & Clock Action */}
      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        <Card title="Today's Shift">
          {todayShifts.length > 0 ? (
            <div className="space-y-3">
              {todayShifts.map((shift) => (
                <div key={shift.id} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">
                      {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                    </p>
                    {shift.role_label && (
                      <p className="text-sm text-gray-500">{shift.role_label}</p>
                    )}
                    {shift.location && (
                      <p className="text-sm text-gray-500 flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {shift.location.name}
                      </p>
                    )}
                  </div>
                  <Badge variant={shift.status === 'in_progress' ? 'approved' : 'info'}>
                    {shift.status.replace('_', ' ')}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No shifts scheduled for today.</p>
          )}
        </Card>

        <Card title="Time Clock">
          <div className="flex flex-col items-center py-4">
            {activeClock ? (
              <>
                <div className="mb-3 text-center">
                  <p className="text-sm text-gray-500">Clocked in since</p>
                  <p className="text-lg font-semibold text-green-700">
                    {formatTime(activeClock.clock_in)}
                  </p>
                </div>
                <Button
                  variant="danger"
                  icon={<Clock className="h-4 w-4" />}
                  loading={clockOutMutation.isPending}
                  onClick={() => clockOutMutation.mutate(activeClock.id)}
                >
                  Clock Out
                </Button>
              </>
            ) : (
              <>
                <p className="mb-3 text-sm text-gray-500">You are not clocked in.</p>
                <Button
                  icon={<Clock className="h-4 w-4" />}
                  loading={clockInMutation.isPending}
                  onClick={() => clockInMutation.mutate()}
                >
                  Clock In
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Upcoming Shifts & Pending Requests */}
      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card
          title="Upcoming Shifts"
          actions={
            <Link to="/portal/schedule" className="text-sm text-primary hover:underline">
              View all
            </Link>
          }
        >
          {shiftsLoading ? (
            <LoadingSpinner size="sm" />
          ) : upcomingShifts.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {upcomingShifts.map((shift) => (
                <li key={shift.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{formatDate(shift.date)}</p>
                    <p className="text-sm text-gray-500">
                      {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                    </p>
                  </div>
                  {shift.role_label && (
                    <span className="text-xs text-gray-400">{shift.role_label}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No upcoming shifts this week.</p>
          )}
        </Card>

        <Card title="Pending Requests">
          <div className="space-y-3">
            <Link
              to="/portal/time-off"
              className="flex items-center justify-between rounded-lg border border-gray-100 p-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-yellow-500" />
                <span className="text-sm font-medium text-gray-700">Time Off Requests</span>
              </div>
              {pendingTimeOff > 0 && (
                <Badge variant="pending">{pendingTimeOff}</Badge>
              )}
            </Link>
            <Link
              to="/portal/shift-swaps"
              className="flex items-center justify-between rounded-lg border border-gray-100 p-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-blue-500" />
                <span className="text-sm font-medium text-gray-700">Shift Swaps</span>
              </div>
              {pendingSwaps > 0 && <Badge variant="pending">{pendingSwaps}</Badge>}
            </Link>
          </div>
        </Card>
      </div>

      {/* Announcements */}
      <Card
        title="Announcements"
        actions={
          <Link to="/portal/messages" className="text-sm text-primary hover:underline">
            View all messages
          </Link>
        }
      >
        {announcements && announcements.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {announcements.slice(0, 5).map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex items-start gap-3">
                  <Bell className="mt-0.5 h-4 w-4 text-yellow-500 flex-shrink-0" />
                  <div>
                    {a.subject && (
                      <p className="text-sm font-medium text-gray-900">{a.subject}</p>
                    )}
                    <p className="text-sm text-gray-600">{a.body}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {a.sender
                        ? `${a.sender.first_name} ${a.sender.last_name}`
                        : 'System'}{' '}
                      - {formatDate(a.created_at)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No announcements.</p>
        )}
      </Card>
    </>
  );
}

// ============================================================
// Manager Dashboard Section (uses /dashboard/manager endpoint)
// ============================================================

function ManagerDashboard({ locationId, isOwner }: { locationId: number; isOwner: boolean }) {
  const queryClient = useQueryClient();

  const { data: allLocations } = useQuery({
    queryKey: ['all-locations'],
    queryFn: locationsApi.list,
    enabled: isOwner,
  });

  const [selectedLocationId, setSelectedLocationId] = useState<number>(locationId);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['manager-dashboard', selectedLocationId],
    queryFn: () => dashboard.getManagerDashboard(selectedLocationId),
    refetchInterval: 30000,
    enabled: selectedLocationId > 0,
  });

  const { data: pendingTimeOffData } = useQuery({
    queryKey: ['pending-time-off-manager'],
    queryFn: () => timeOff.list({ status: 'pending' as never }),
    refetchInterval: 30000,
  });

  const { data: pendingSwapsData } = useQuery({
    queryKey: ['pending-swaps-manager'],
    queryFn: () => shiftSwaps.list({ status: 'pending' as never }),
    refetchInterval: 30000,
  });

  const { data: pendingCoverageData } = useQuery({
    queryKey: ['pending-coverage-manager'],
    queryFn: () => shiftCoverage.list({ status: 'pending' as never }),
    refetchInterval: 30000,
  });

  const reviewTimeOffMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'approved' | 'denied' }) =>
      timeOff.review(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-time-off-manager'] });
      queryClient.invalidateQueries({ queryKey: ['manager-dashboard'] });
    },
  });

  const reviewSwapMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'approved' | 'denied' }) =>
      shiftSwaps.review(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-swaps-manager'] });
      queryClient.invalidateQueries({ queryKey: ['manager-dashboard'] });
    },
  });

  const reviewCoverageMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'approved' | 'denied' }) =>
      shiftCoverage.review(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-coverage-manager'] });
      queryClient.invalidateQueries({ queryKey: ['manager-dashboard'] });
    },
  });

  const pendingTimeOffItems = pendingTimeOffData?.items ?? [];
  const pendingSwapItems = pendingSwapsData?.items ?? [];
  const pendingCoverageItems = pendingCoverageData?.items ?? [];

  const [approvalTab, setApprovalTab] = useState<'timeoff' | 'swaps' | 'coverage'>('timeoff');

  if (isLoading) {
    return <LoadingSpinner className="py-12" label="Loading manager dashboard..." />;
  }

  if (isError) {
    return (
      <Card className="mb-6">
        <div className="flex items-center gap-3 text-red-600">
          <AlertCircle className="h-5 w-5" />
          <p className="text-sm">Failed to load manager dashboard. Please try again.</p>
        </div>
      </Card>
    );
  }

  const todaySummary = data?.today_summary ?? {};
  const workingNow = data?.working_now ?? [];
  const onBreak = data?.on_break ?? [];
  const lateEmployees = data?.late_employees ?? [];
  const drawerData = data?.cash_drawer ?? null;
  const overtimeAlerts = data?.overtime_alerts ?? [];
  const availableToCall = data?.available_to_call ?? [];

  return (
    <div className="mb-6">
      {/* Location Selector (owner only) */}
      {isOwner && allLocations && allLocations.length > 1 && (
        <div className="mb-6">
          <label htmlFor="location-select" className="block text-sm font-medium text-gray-700 mb-1">
            Location
          </label>
          <select
            id="location-select"
            value={selectedLocationId}
            onChange={(e) => setSelectedLocationId(Number(e.target.value))}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {allLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <h2 className="text-lg font-semibold text-gray-900 mb-4">Manager Dashboard</h2>

      {/* Row 1: Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-50 p-2.5">
              <Calendar className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Scheduled Today</p>
              <p className="text-xl font-bold text-gray-900">
                {todaySummary.scheduled_count ?? 0}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-50 p-2.5">
              <Clock className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Clocked In</p>
              <p className="text-xl font-bold text-gray-900">
                {todaySummary.clocked_in_count ?? 0}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-yellow-50 p-2.5">
              <Coffee className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">On Break</p>
              <p className="text-xl font-bold text-gray-900">
                {todaySummary.on_break_count ?? 0}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-50 p-2.5">
              <TrendingUp className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Hours Today</p>
              <p className="text-xl font-bold text-gray-900">
                {typeof todaySummary.total_hours_today === 'number'
                  ? todaySummary.total_hours_today.toFixed(1)
                  : '0.0'}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Row 2: Who's Working Now + Cash Drawer */}
      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card title="Who's Working Now">
          <div className="space-y-3">
            {/* Clocked In */}
            {workingNow.length > 0 ? (
              workingNow.map((emp: any) => (
                <div key={emp.id ?? emp.user_id} className="flex items-center gap-3">
                  <span className="flex h-2.5 w-2.5 rounded-full bg-green-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {emp.first_name ?? emp.name} {emp.last_name ?? ''}
                    </p>
                    <p className="text-xs text-gray-500">
                      Since {emp.clock_in ? formatTimeTz(emp.clock_in) : 'N/A'}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-400">No one clocked in right now.</p>
            )}

            {/* On Break */}
            {onBreak.length > 0 &&
              onBreak.map((emp: any) => (
                <div key={emp.id ?? emp.user_id} className="flex items-center gap-3">
                  <span className="flex h-2.5 w-2.5 rounded-full bg-yellow-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {emp.first_name ?? emp.name} {emp.last_name ?? ''}
                    </p>
                    <p className="text-xs text-gray-500">
                      {emp.break_type ?? 'Break'}
                    </p>
                  </div>
                </div>
              ))}

            {/* Late / Not Clocked In */}
            {lateEmployees.length > 0 &&
              lateEmployees.map((emp: any) => (
                <div key={emp.id ?? emp.user_id} className="flex items-center gap-3">
                  <span className="flex h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {emp.first_name ?? emp.name} {emp.last_name ?? ''}
                    </p>
                    <p className="text-xs text-red-600">
                      {emp.minutes_late
                        ? `${emp.minutes_late} min late`
                        : emp.shift_time
                          ? formatTimeTz(emp.shift_time)
                          : 'Not clocked in'}
                    </p>
                  </div>
                </div>
              ))}

            {workingNow.length === 0 && onBreak.length === 0 && lateEmployees.length === 0 && (
              <p className="text-sm text-gray-400">No one scheduled right now.</p>
            )}
          </div>
        </Card>

        <Card title="Cash Drawer">
          {drawerData && drawerData.is_open ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-green-700">Drawer Open</span>
              </div>
              <div className="space-y-1 text-sm text-gray-600">
                <p>
                  Opening amount:{' '}
                  <span className="font-medium text-gray-900">
                    ${(drawerData.opening_amount ?? drawerData.starting_cash ?? 0).toFixed(2)}
                  </span>
                </p>
                {drawerData.expected_closing != null && (
                  <p>
                    Expected:{' '}
                    <span className="font-medium text-gray-900">
                      ${drawerData.expected_closing.toFixed(2)}
                    </span>
                  </p>
                )}
                <p>
                  Opened by:{' '}
                  <span className="font-medium text-gray-900">
                    {drawerData.opened_by_name ?? 'Unknown'}
                  </span>
                </p>
                {(drawerData.expenses_total != null && drawerData.expenses_total > 0) && (
                  <p>
                    Expenses:{' '}
                    <span className="font-medium text-red-600">
                      ${drawerData.expenses_total.toFixed(2)}
                    </span>
                  </p>
                )}
              </div>
              <Link to="/portal/cash-drawer">
                <Button variant="ghost" size="sm">
                  Manage <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-gray-400">
              <CreditCard className="h-8 w-8 mb-2" />
              <p className="text-sm">No drawer open</p>
            </div>
          )}
        </Card>
      </div>

      {/* Row 3: Overtime Alerts + Available to Call */}
      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card title="Overtime Alerts">
          {overtimeAlerts.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {overtimeAlerts.map((alert: any) => (
                <li key={alert.id ?? alert.user_id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {alert.first_name ?? alert.name} {alert.last_name ?? ''}
                    </p>
                    <p className="text-xs text-gray-500">
                      {typeof alert.hours_this_week === 'number'
                        ? `${alert.hours_this_week.toFixed(1)}h this week`
                        : ''}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-semibold ${
                      (alert.projected_total ?? alert.hours_this_week ?? 0) > 40
                        ? 'text-red-600'
                        : 'text-yellow-600'
                    }`}
                  >
                    {typeof alert.projected_total === 'number'
                      ? `${alert.projected_total.toFixed(1)}h projected`
                      : typeof alert.hours_this_week === 'number'
                        ? `${alert.hours_this_week.toFixed(1)}h`
                        : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 py-4 text-sm text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              No overtime concerns this week
            </div>
          )}
        </Card>

        <Card title="Available to Call">
          {availableToCall.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {availableToCall.map((emp: any) => (
                <li key={emp.id ?? emp.user_id} className="flex items-center justify-between py-3">
                  <p className="text-sm font-medium text-gray-900">
                    {emp.first_name ?? emp.name} {emp.last_name ?? ''}
                  </p>
                  {emp.phone ? (
                    <a
                      href={`tel:${emp.phone}`}
                      className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      {emp.phone}
                    </a>
                  ) : (
                    <span className="text-xs text-gray-400">No phone</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
              <Users className="h-5 w-5" />
              Everyone is scheduled or off today
            </div>
          )}
        </Card>
      </div>

      {/* Row 4: Pending Approvals */}
      <Card title="Pending Approvals" className="mb-6">
        {/* Tab buttons */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setApprovalTab('timeoff')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              approvalTab === 'timeoff'
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Time Off
            {pendingTimeOffItems.length > 0 && (
              <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-xs">
                {pendingTimeOffItems.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setApprovalTab('swaps')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              approvalTab === 'swaps'
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Shift Swaps
            {pendingSwapItems.length > 0 && (
              <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-xs">
                {pendingSwapItems.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setApprovalTab('coverage')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              approvalTab === 'coverage'
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Coverage
            {pendingCoverageItems.length > 0 && (
              <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-xs">
                {pendingCoverageItems.length}
              </span>
            )}
          </button>
        </div>

        {/* Time Off tab */}
        {approvalTab === 'timeoff' && (
          <div>
            {pendingTimeOffItems.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {pendingTimeOffItems.map((req: any) => (
                  <li key={req.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {req.user
                          ? `${req.user.first_name} ${req.user.last_name}`
                          : req.employee_name ?? `Employee #${req.user_id ?? req.employee_id}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        {req.start_date} - {req.end_date}
                        {req.reason && ` - ${req.reason}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        loading={reviewTimeOffMutation.isPending}
                        onClick={() => reviewTimeOffMutation.mutate({ id: req.id, status: 'approved' })}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={reviewTimeOffMutation.isPending}
                        onClick={() => reviewTimeOffMutation.mutate({ id: req.id, status: 'denied' })}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400 py-2">No pending time off requests.</p>
            )}
          </div>
        )}

        {/* Shift Swaps tab */}
        {approvalTab === 'swaps' && (
          <div>
            {pendingSwapItems.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {pendingSwapItems.map((swap: any) => (
                  <li key={swap.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {swap.requester
                          ? `${swap.requester.first_name} ${swap.requester.last_name}`
                          : `Employee #${swap.requester_id}`}
                        {' <> '}
                        {swap.target
                          ? `${swap.target.first_name} ${swap.target.last_name}`
                          : `Employee #${swap.target_id}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        {swap.requesting_shift?.date ?? swap.date ?? ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        loading={reviewSwapMutation.isPending}
                        onClick={() => reviewSwapMutation.mutate({ id: swap.id, status: 'approved' })}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={reviewSwapMutation.isPending}
                        onClick={() => reviewSwapMutation.mutate({ id: swap.id, status: 'denied' })}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400 py-2">No pending shift swaps.</p>
            )}
          </div>
        )}

        {/* Coverage tab */}
        {approvalTab === 'coverage' && (
          <div>
            {pendingCoverageItems.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {pendingCoverageItems.map((cov: any) => (
                  <li key={cov.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {cov.requester
                          ? `${cov.requester.first_name} ${cov.requester.last_name}`
                          : cov.employee_name ?? `Employee #${cov.requester_id ?? cov.user_id}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        {cov.shift?.date ?? cov.date ?? ''}
                        {cov.notes && ` - ${cov.notes}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        loading={reviewCoverageMutation.isPending}
                        onClick={() => reviewCoverageMutation.mutate({ id: cov.id, status: 'approved' })}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={reviewCoverageMutation.isPending}
                        onClick={() => reviewCoverageMutation.mutate({ id: cov.id, status: 'denied' })}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400 py-2">No pending coverage requests.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ============================================================
// Owner Dashboard Section
// ============================================================

function OwnerDashboard() {
  const { data: allLocations, isLoading: locsLoading } = useQuery({
    queryKey: ['all-locations'],
    queryFn: locationsApi.list,
  });

  const { data: summaryData } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: dashboard.getSummary,
    refetchInterval: 30000,
  });

  const locationIds = allLocations?.map((l) => l.id) ?? [];

  const locationDashboards = useQuery({
    queryKey: ['all-location-dashboards', locationIds],
    queryFn: async () => {
      if (!allLocations || allLocations.length === 0) return [];
      const results = await Promise.allSettled(
        allLocations.map((loc) => dashboard.getLocationData(loc.id))
      );
      return results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value);
    },
    enabled: !!allLocations && allLocations.length > 0,
    refetchInterval: 60000,
  });

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Owner Overview</h2>

      {/* High-level KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-50 p-2.5">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Weekly Hours</p>
              <p className="text-xl font-bold text-gray-900">
                {summaryData?.weekly_hours?.toFixed(1) ?? '0'}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-50 p-2.5">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Active Employees</p>
              <p className="text-xl font-bold text-gray-900">
                {summaryData?.active_employees ?? 0}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-50 p-2.5">
              <CreditCard className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Open Drawers</p>
              <p className="text-xl font-bold text-gray-900">
                {summaryData?.open_drawers ?? 0}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-50 p-2.5">
              <AlertCircle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Pending Requests</p>
              <p className="text-xl font-bold text-gray-900">
                {summaryData?.pending_requests ?? 0}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Location Cards */}
      <Card title="All Locations" className="mb-6">
        {locsLoading ? (
          <LoadingSpinner size="sm" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {allLocations?.map((loc) => {
              const locData = locationDashboards.data?.find(
                (ld: any) => (ld.location_id ?? ld.location?.id) === loc.id
              );
              return (
                <div
                  key={loc.id}
                  className="rounded-lg border border-gray-200 p-4 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h4 className="font-medium text-gray-900">{loc.name}</h4>
                      <p className="text-xs text-gray-500 flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {loc.address}
                      </p>
                    </div>
                  </div>
                  {locData && (
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-lg font-semibold text-gray-900">
                          {locData.scheduled_shifts ?? 0}
                        </p>
                        <p className="text-xs text-gray-500">Shifts</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-green-600">
                          {locData.currently_clocked_in ?? 0}
                        </p>
                        <p className="text-xs text-gray-500">Active</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-yellow-600">
                          0
                        </p>
                        <p className="text-xs text-gray-500">Pending</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Quick Nav & Alerts */}
      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card title="Quick Navigation">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Payroll', to: '/portal/payroll', icon: <DollarSign className="h-4 w-4" /> },
              { label: 'Employees', to: '/portal/employees', icon: <Users className="h-4 w-4" /> },
              { label: 'Locations', to: '/portal/locations', icon: <MapPin className="h-4 w-4" /> },
              { label: 'Audit Log', to: '/portal/audit-log', icon: <ShieldCheck className="h-4 w-4" /> },
              { label: 'Cash Drawers', to: '/portal/cash-drawer', icon: <CreditCard className="h-4 w-4" /> },
              { label: 'Documents', to: '/portal/documents', icon: <FileText className="h-4 w-4" /> },
            ].map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="flex items-center gap-2 rounded-lg border border-gray-100 p-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {link.icon}
                {link.label}
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Cash Variance">
          <div className="flex items-center gap-2 py-4 text-sm text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            Today&apos;s variance: ${summaryData?.today_cash_variance?.toFixed(2) ?? '0.00'}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// Main Dashboard Page
// ============================================================

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  if (!user) return null;

  const isEmployee = user.role === UserRole.EMPLOYEE;
  const isManager = user.role === UserRole.MANAGER || user.role === UserRole.OWNER;
  const isOwner = user.role === UserRole.OWNER;
  const locationId = user.primary_location_id ?? user.location_ids?.[0] ?? 1;

  // Employees get a clean personal dashboard without owner/manager API calls
  if (isEmployee) {
    return (
      <EmployeeDashboardPage userId={user.id} locationId={locationId} firstName={user.first_name} />
    );
  }

  // Owner/Manager dashboard with summary stats
  return (
    <ManagerOwnerDashboardPage
      user={user}
      isOwner={isOwner}
      isManager={isManager}
      locationId={locationId}
    />
  );
}

// ============================================================
// Employee-only Dashboard Page (no owner/manager API calls)
// ============================================================

function getPayPeriod(): { start: string; end: string; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  if (day <= 14) {
    const start = new Date(year, month, 1);
    const end = new Date(year, month, 14);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0], label: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
  } else {
    const start = new Date(year, month, 15);
    const lastDay = new Date(year, month + 1, 0).getDate();
    const end = new Date(year, month, lastDay);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0], label: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
  }
}


function EmployeeDashboardPage({ userId, locationId, firstName }: { userId: number; locationId: number; firstName: string }) {
  const week = getWeekRange();
  const payPeriod = getPayPeriod();

  const { data: nextShifts, isLoading: shiftsLoading } = useQuery({
    queryKey: ['my-shifts'],
    queryFn: () => schedules.myShifts(),
  });

  const { data: clockRecords } = useQuery({
    queryKey: ['my-clock-week', week],
    queryFn: () => timeClock.getRecords({ user_id: userId, start_date: week.start_date, end_date: week.end_date }),
  });

  const { data: payPeriodRecords } = useQuery({
    queryKey: ['my-clock-period', payPeriod.start, payPeriod.end],
    queryFn: () => timeClock.getRecords({ user_id: userId, start_date: payPeriod.start, end_date: payPeriod.end }),
  });

  const { data: unreadData } = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => messagesApi.getUnreadCount(),
    refetchInterval: 60000,
  });

  const { data: locationsList } = useQuery({
    queryKey: ['locations'],
    queryFn: () => locationsApi.list(),
  });

  if (shiftsLoading) {
    return <LoadingSpinner className="py-20" label="Loading dashboard..." />;
  }

  const now = new Date();
  const nextShift = nextShifts?.sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time))?.[0];

  const weeklyHours = (clockRecords?.items ?? []).reduce((total, record) => {
    return total + (record.total_hours ?? 0);
  }, 0);

  const periodHours = (payPeriodRecords?.items ?? []).reduce((total, record) => {
    return total + (record.total_hours ?? 0);
  }, 0);

  const unreadCount = unreadData?.unread_count ?? 0;

  const myLocationNames = (locationsList ?? [])
    .filter((l) => (useAuthStore.getState().user?.location_ids ?? []).includes(l.id))
    .map((l) => l.name.replace('Six Beans - ', ''));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome back, {firstName}!</h1>
          <div className="flex items-center gap-2 mt-1">
            {myLocationNames.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
                <MapPin className="h-4 w-4" style={{ color: '#5CB832' }} />
                {myLocationNames.join(' · ')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {/* Next Shift */}
        <Card>
          <div className="flex items-center gap-4">
            <div className="rounded-lg p-3 bg-purple-50 text-purple-600"><Calendar className="h-6 w-6" /></div>
            <div>
              <p className="text-sm text-gray-500">Next Shift</p>
              {nextShift ? (
                <>
                  <p className="text-lg font-bold text-gray-900">{formatDate(nextShift.date)}</p>
                  <p className="text-xs text-gray-500">{nextShift.start_time?.slice(0,5)} - {nextShift.end_time?.slice(0,5)}</p>
                </>
              ) : (
                <p className="text-sm text-gray-400">No upcoming shifts</p>
              )}
            </div>
          </div>
        </Card>

        {/* Hours This Week */}
        <Card>
          <div className="flex items-center gap-4">
            <div className="rounded-lg p-3 bg-green-50 text-green-600"><Clock className="h-6 w-6" /></div>
            <div>
              <p className="text-sm text-gray-500">Hours This Week</p>
              <p className="text-2xl font-bold text-gray-900">{weeklyHours.toFixed(1)}</p>
            </div>
          </div>
        </Card>

        {/* Pay Period Hours */}
        <Card>
          <div className="flex items-center gap-4">
            <div className="rounded-lg p-3 bg-emerald-50 text-emerald-600"><TrendingUp className="h-6 w-6" /></div>
            <div>
              <p className="text-sm text-gray-500">Pay Period Hours</p>
              <p className="text-2xl font-bold text-gray-900">{periodHours.toFixed(1)}</p>
              <p className="text-[10px] text-gray-400">{payPeriod.label}</p>
            </div>
          </div>
        </Card>

        {/* Messages */}
        <Card>
          <Link to="/portal/messages" className="flex items-center gap-4">
            <div className="rounded-lg p-3 bg-blue-50 text-blue-600 relative">
              <Bell className="h-6 w-6" />
              {unreadCount > 0 && <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">{unreadCount}</span>}
            </div>
            <div>
              <p className="text-sm text-gray-500">Messages</p>
              <p className="text-lg font-bold text-gray-900">{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
            </div>
          </Link>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card title="Quick Actions" className="mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Link to="/portal/time-clock" className="flex items-center gap-2 rounded-lg border border-gray-100 p-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"><Clock className="h-4 w-4" />Clock In</Link>
          <Link to="/portal/schedule" className="flex items-center gap-2 rounded-lg border border-gray-100 p-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"><Calendar className="h-4 w-4" />View Schedule</Link>
          <Link to="/portal/time-off" className="flex items-center gap-2 rounded-lg border border-gray-100 p-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"><FileText className="h-4 w-4" />Request Time Off</Link>
          <Link to="/portal/messages" className="flex items-center gap-2 rounded-lg border border-gray-100 p-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"><Bell className="h-4 w-4" />Messages</Link>
        </div>
      </Card>

      <EmployeeDashboard userId={userId} locationId={locationId} />
    </div>
  );
}

// ============================================================
// Manager/Owner Dashboard Page (with summary stats)
// ============================================================

function ManagerOwnerDashboardPage({
  user,
  isOwner,
  isManager,
  locationId,
}: {
  user: { id: number; first_name: string };
  isOwner: boolean;
  isManager: boolean;
  locationId: number;
}) {
  const { data: summary, isLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: dashboard.getSummary,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return <LoadingSpinner className="py-20" label="Loading dashboard..." />;
  }

  const stats = [
    {
      label: 'Active Employees',
      value: summary?.active_employees ?? 0,
      icon: <Users className="h-6 w-6" />,
      color: 'bg-blue-50 text-blue-600',
    },
    {
      label: "Today's Shifts",
      value: summary?.today_scheduled_shifts ?? summary?.today_shifts ?? 0,
      icon: <Calendar className="h-6 w-6" />,
      color: 'bg-purple-50 text-purple-600',
    },
    {
      label: 'Clocked In',
      value: summary?.currently_clocked_in ?? summary?.clocked_in_count ?? 0,
      icon: <Clock className="h-6 w-6" />,
      color: 'bg-green-50 text-green-600',
    },
    {
      label: 'Pending Requests',
      value: summary?.pending_time_off_requests ?? summary?.pending_requests ?? 0,
      icon: <AlertCircle className="h-6 w-6" />,
      color: 'bg-yellow-50 text-yellow-600',
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome back, {user.first_name}!</h1>
          <p className="page-subtitle">
            {isOwner
              ? 'Here is your business overview.'
              : 'Your location and personal overview.'}
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <div className="flex items-center gap-4">
              <div className={`rounded-lg p-3 ${stat.color}`}>{stat.icon}</div>
              <div>
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Owner-specific sections */}
      {isOwner && <OwnerDashboard />}

      {/* Manager dashboard (for both managers and owners) */}
      {isManager && (
        <ManagerDashboard locationId={locationId} isOwner={isOwner} />
      )}

      {/* Personal shift/clock sections for managers (they work shifts too) */}
      {!isOwner && <EmployeeDashboard userId={user.id} locationId={locationId} />}
    </div>
  );
}
