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
  ClipboardList,
  CreditCard,
  ShieldCheck,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
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
import { UserRole, type ScheduledShift, type LocationDashboardData } from '@/types';

function formatTime(timeStr: string) {
  const date = new Date(timeStr);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString([], {
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
// Manager Dashboard Section
// ============================================================

function ManagerDashboard({ locationId }: { locationId: number }) {
  const { data: locationData, isLoading } = useQuery({
    queryKey: ['location-dashboard', locationId],
    queryFn: () => dashboard.getLocationData(locationId),
    refetchInterval: 30000,
  });

  const { data: pendingTimeOffData } = useQuery({
    queryKey: ['pending-time-off-manager'],
    queryFn: () => timeOff.list({ status: 'pending' as never }),
  });

  const { data: pendingSwapsData } = useQuery({
    queryKey: ['pending-swaps-manager'],
    queryFn: () => shiftSwaps.list({ status: 'pending' as never }),
  });

  const { data: pendingCoverageData } = useQuery({
    queryKey: ['pending-coverage-manager'],
    queryFn: () => shiftCoverage.list({ status: 'pending' as never }),
  });

  if (isLoading) return null;

  const pendingTimeOff = pendingTimeOffData?.items?.length ?? 0;
  const pendingSwaps = pendingSwapsData?.items?.length ?? 0;
  const pendingCoverage = pendingCoverageData?.items?.length ?? 0;
  const totalPending = pendingTimeOff + pendingSwaps + pendingCoverage;

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Manager Overview</h2>

      {/* Staffing & Approvals */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-50 p-2.5">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Today&apos;s Shifts</p>
              <p className="text-xl font-bold text-gray-900">
                {locationData?.today_shifts?.length ?? 0}
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
                {locationData?.clocked_in?.length ?? 0}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-yellow-50 p-2.5">
              <AlertCircle className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Pending Approvals</p>
              <p className="text-xl font-bold text-gray-900">{totalPending}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-50 p-2.5">
              <CreditCard className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Cash Drawer</p>
              <p className="text-xl font-bold text-gray-900">
                {locationData?.open_drawer ? 'Open' : 'Closed'}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Approval Queue & Today's Staff */}
      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card title="Approval Queue">
          <div className="space-y-2">
            <Link
              to="/portal/time-off"
              className="flex items-center justify-between rounded-lg p-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-yellow-500" />
                <span className="text-sm text-gray-700">Time Off Requests</span>
              </div>
              <div className="flex items-center gap-2">
                {pendingTimeOff > 0 && <Badge variant="pending">{pendingTimeOff}</Badge>}
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </div>
            </Link>
            <Link
              to="/portal/shift-swaps"
              className="flex items-center justify-between rounded-lg p-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-blue-500" />
                <span className="text-sm text-gray-700">Shift Swaps</span>
              </div>
              <div className="flex items-center gap-2">
                {pendingSwaps > 0 && <Badge variant="pending">{pendingSwaps}</Badge>}
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </div>
            </Link>
            <Link
              to="/portal/shift-swaps"
              className="flex items-center justify-between rounded-lg p-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <ClipboardList className="h-5 w-5 text-indigo-500" />
                <span className="text-sm text-gray-700">Coverage Requests</span>
              </div>
              <div className="flex items-center gap-2">
                {pendingCoverage > 0 && <Badge variant="pending">{pendingCoverage}</Badge>}
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </div>
            </Link>
          </div>
        </Card>

        <Card title="Today's Staff">
          {locationData?.today_shifts && locationData.today_shifts.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {locationData.today_shifts.slice(0, 6).map((shift) => (
                <li key={shift.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {shift.user
                        ? `${shift.user.first_name} ${shift.user.last_name}`
                        : `Employee #${shift.user_id}`}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                      {shift.role_label && ` (${shift.role_label})`}
                    </p>
                  </div>
                  <Badge
                    variant={
                      shift.status === 'in_progress'
                        ? 'approved'
                        : shift.status === 'completed'
                          ? 'info'
                          : 'pending'
                    }
                  >
                    {shift.status === 'in_progress' ? 'Active' : shift.status}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No shifts scheduled for today.</p>
          )}
        </Card>
      </div>

      {/* Cash Drawer Status */}
      {locationData?.open_drawer && (
        <Card title="Cash Drawer Status">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">
                Opened by{' '}
                {locationData.open_drawer.opener
                  ? `${locationData.open_drawer.opener.first_name} ${locationData.open_drawer.opener.last_name}`
                  : 'Unknown'}{' '}
                at {formatTime(locationData.open_drawer.open_time)}
              </p>
              <p className="text-sm text-gray-500">
                Starting cash: ${locationData.open_drawer.starting_cash.toFixed(2)}
              </p>
            </div>
            <Link to="/portal/cash-drawer">
              <Button variant="ghost" size="sm">
                Manage <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </div>
        </Card>
      )}
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

  const { data: recentDrawers } = useQuery({
    queryKey: ['recent-drawers'],
    queryFn: () =>
      cashDrawer.getReport({
        start_date: today,
        end_date: today,
      }),
  });

  const locationIds = allLocations?.map((l) => l.id) ?? [];

  const locationDashboards = useQuery({
    queryKey: ['all-location-dashboards', locationIds],
    queryFn: async () => {
      if (!allLocations || allLocations.length === 0) return [];
      const results = await Promise.all(
        allLocations.map((loc) => dashboard.getLocationData(loc.id))
      );
      return results;
    },
    enabled: !!allLocations && allLocations.length > 0,
    refetchInterval: 60000,
  });

  const varianceAlerts =
    recentDrawers?.filter((d) => d.variance && Math.abs(d.variance) > 5) ?? [];

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
                (ld) => ld.location.id === loc.id
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
                          {locData.today_shifts.length}
                        </p>
                        <p className="text-xs text-gray-500">Shifts</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-green-600">
                          {locData.clocked_in.length}
                        </p>
                        <p className="text-xs text-gray-500">Active</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-yellow-600">
                          {locData.pending_time_off + locData.pending_swaps}
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

        <Card title="Cash Variance Alerts">
          {varianceAlerts.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {varianceAlerts.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {d.location?.name ?? `Location #${d.location_id}`}
                    </p>
                    <p className="text-xs text-gray-500">{formatDate(d.created_at)}</p>
                  </div>
                  <span
                    className={`text-sm font-semibold ${
                      (d.variance ?? 0) < 0 ? 'text-red-600' : 'text-green-600'
                    }`}
                  >
                    {(d.variance ?? 0) >= 0 ? '+' : ''}${(d.variance ?? 0).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 py-4 text-sm text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              No cash variance alerts today.
            </div>
          )}
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
  const { data: summary, isLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: dashboard.getSummary,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return <LoadingSpinner className="py-20" label="Loading dashboard..." />;
  }

  if (!user) return null;

  const isManager = user.role === UserRole.MANAGER || user.role === UserRole.OWNER;
  const isOwner = user.role === UserRole.OWNER;

  const stats = [
    {
      label: 'Active Employees',
      value: summary?.active_employees ?? 0,
      icon: <Users className="h-6 w-6" />,
      color: 'bg-blue-50 text-blue-600',
    },
    {
      label: "Today's Shifts",
      value: summary?.today_shifts ?? 0,
      icon: <Calendar className="h-6 w-6" />,
      color: 'bg-purple-50 text-purple-600',
    },
    {
      label: 'Clocked In',
      value: summary?.clocked_in_count ?? 0,
      icon: <Clock className="h-6 w-6" />,
      color: 'bg-green-50 text-green-600',
    },
    {
      label: 'Pending Requests',
      value: summary?.pending_requests ?? 0,
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
              : isManager
                ? 'Here is what is happening at your location.'
                : 'Here is what is happening today.'}
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

      {/* Manager-specific sections */}
      {isManager && !isOwner && (
        <ManagerDashboard locationId={user.primary_location_id} />
      )}

      {/* Employee sections (shown for all roles) */}
      <EmployeeDashboard userId={user.id} locationId={user.primary_location_id} />
    </div>
  );
}
