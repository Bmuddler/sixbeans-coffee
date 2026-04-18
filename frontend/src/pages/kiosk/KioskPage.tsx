import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Coffee,
  LogIn,
  LogOut,
  Clock,
  DollarSign,
  AlertTriangle,
  Delete,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { kiosk, locations as locationsApi } from '@/lib/api';
import type {
  KioskAuthResponse,
  ScheduledShift,
  Location,
  TimeClock,
  CashDrawer,
  BreakType,
} from '@/types';

const INACTIVITY_TIMEOUT = 60_000; // 60 seconds
const EXPENSE_CATEGORIES = [
  { value: 'CO2 Delivery', label: 'CO2 Delivery' },
  { value: 'Supply Run', label: 'Supply Run' },
  { value: 'Other', label: 'Other' },
];

function formatTime(iso: string) {
  return format(parseISO(iso), 'h:mm a');
}

export function KioskPage() {
  const [pin, setPin] = useState('');
  const [locationId, setLocationId] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<KioskAuthResponse | null>(null);
  const [todaySchedule, setTodaySchedule] = useState<ScheduledShift[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsLoaded, setLocationsLoaded] = useState(false);

  // Modal states
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showDrawerStartModal, setShowDrawerStartModal] = useState(false);
  const [showDrawerEndModal, setShowDrawerEndModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  // Form states
  const [expenseForm, setExpenseForm] = useState({
    amount: '',
    category: 'CO2 Delivery',
    notes: '',
  });
  const [drawerStartAmount, setDrawerStartAmount] = useState('');
  const [drawerEndAmount, setDrawerEndAmount] = useState('');
  const [drawerEndNotes, setDrawerEndNotes] = useState('');
  const [activeDrawer, setActiveDrawer] = useState<CashDrawer | null>(null);

  // Action loading states
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Inactivity timer ref
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load locations on mount
  useEffect(() => {
    locationsApi.list().then((locs) => {
      setLocations(locs);
      setLocationsLoaded(true);
      if (locs.length > 0) setLocationId(locs[0].id);
    }).catch(() => {
      setLocationsLoaded(true);
    });
  }, []);

  // Inactivity auto-logout
  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (session) {
      timerRef.current = setTimeout(() => {
        setSession(null);
        setPin('');
        toast('Session expired due to inactivity', { icon: '🕐' });
      }, INACTIVITY_TIMEOUT);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;

    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [session, resetTimer]);

  // Load schedule on auth
  useEffect(() => {
    if (session) {
      kiosk
        .getTodaySchedule(locationId)
        .then(setTodaySchedule)
        .catch(() => {});
    }
  }, [session, locationId]);

  // PIN pad handling
  const handlePinDigit = (digit: string) => {
    if (pin.length < 4) setPin((prev) => prev + digit);
  };

  const handlePinDelete = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  const handleAuth = async () => {
    if (pin.length < 4) return;
    setLoading(true);
    try {
      const res = await kiosk.authenticate({ pin_code: pin, location_id: locationId });
      setSession(res);
      toast.success(`Welcome, ${res.user.first_name}!`);
      setPin('');
    } catch {
      toast.error('Invalid PIN. Please try again.');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  // Auto-submit when 4 digits entered
  useEffect(() => {
    if (pin.length === 4 && !session) {
      handleAuth();
    }
  }, [pin]);

  // Actions
  const handleClockIn = async () => {
    if (!session) return;
    setActionLoading('clockIn');
    try {
      const result = await kiosk.clockIn({
        session_token: session.session_token,
        location_id: locationId,
      });
      setSession({ ...session, active_clock: result });
      toast.success('Clocked in!');
    } catch {
      toast.error('Failed to clock in.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleClockOut = async () => {
    if (!session?.active_clock) return;
    setActionLoading('clockOut');
    try {
      await kiosk.clockOut({
        session_token: session.session_token,
        time_clock_id: session.active_clock.id,
      });
      setSession({ ...session, active_clock: undefined });
      toast.success('Clocked out!');
    } catch {
      toast.error('Failed to clock out.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartBreak = async (breakType: string) => {
    if (!session?.active_clock) return;
    setActionLoading(`break-${breakType}`);
    try {
      const result = await kiosk.startBreak({
        session_token: session.session_token,
        time_clock_id: session.active_clock.id,
        break_type: breakType,
      });
      setSession({ ...session, active_clock: result });
      toast.success(`${breakType === 'paid' ? '10 min' : '30 min'} break started!`);
    } catch {
      toast.error('Failed to start break.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleEndBreak = async () => {
    if (!session?.active_clock) return;
    setActionLoading('endBreak');
    try {
      const result = await kiosk.endBreak({
        session_token: session.session_token,
        time_clock_id: session.active_clock.id,
      });
      setSession({ ...session, active_clock: result });
      toast.success('Break ended!');
    } catch {
      toast.error('Failed to end break.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartDrawer = async () => {
    if (!session) return;
    setActionLoading('startDrawer');
    try {
      const result = await kiosk.startDrawer({
        session_token: session.session_token,
        location_id: locationId,
        starting_cash: parseFloat(drawerStartAmount),
      });
      setActiveDrawer(result);
      setShowDrawerStartModal(false);
      setDrawerStartAmount('');
      toast.success('Cash drawer opened!');
    } catch {
      toast.error('Failed to open drawer.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleEndDrawer = async () => {
    if (!session || !activeDrawer) return;
    setActionLoading('endDrawer');
    try {
      await kiosk.endDrawer({
        session_token: session.session_token,
        drawer_id: activeDrawer.id,
        actual_cash: parseFloat(drawerEndAmount),
        notes: drawerEndNotes || undefined,
      });
      setActiveDrawer(null);
      setShowDrawerEndModal(false);
      setDrawerEndAmount('');
      setDrawerEndNotes('');
      toast.success('Cash drawer closed!');
    } catch {
      toast.error('Failed to close drawer.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddExpense = async () => {
    if (!session || !activeDrawer) return;
    setActionLoading('expense');
    try {
      await kiosk.addExpense({
        session_token: session.session_token,
        drawer_id: activeDrawer.id,
        description: `${expenseForm.category}${expenseForm.notes ? ': ' + expenseForm.notes : ''}`,
        amount: parseFloat(expenseForm.amount),
      });
      setShowExpenseModal(false);
      setExpenseForm({ amount: '', category: 'CO2 Delivery', notes: '' });
      toast.success('Expense recorded!');
    } catch {
      toast.error('Failed to record expense.');
    } finally {
      setActionLoading(null);
    }
  };

  const onBreak = session?.active_clock?.breaks?.some((b) => !b.end_time) ?? false;

  // ---- PIN Screen ----
  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh]">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
          <div className="text-center mb-8">
            <Coffee className="mx-auto h-16 w-16 text-primary mb-4" />
            <h1 className="text-3xl font-bold text-gray-900">Six Beans Coffee</h1>
            <p className="text-lg text-gray-500 mt-2">Enter your 4-digit PIN</p>
          </div>

          {/* Location selector */}
          {locationsLoaded && locations.length > 1 && (
            <div className="mb-6">
              <Select
                options={locations.map((l) => ({ value: l.id, label: l.name }))}
                value={locationId}
                onChange={(e) => setLocationId(Number(e.target.value))}
              />
            </div>
          )}

          {/* PIN display */}
          <div className="flex justify-center gap-4 mb-8">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-16 w-16 rounded-2xl border-2 flex items-center justify-center text-3xl font-bold transition-all ${
                  pin.length > i
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                {pin.length > i ? '\u2022' : ''}
              </div>
            ))}
          </div>

          {/* PIN pad */}
          <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                onClick={() => handlePinDigit(digit)}
                disabled={loading}
                className="h-16 rounded-2xl bg-gray-100 text-2xl font-bold text-gray-900 hover:bg-gray-200 active:bg-gray-300 transition-colors disabled:opacity-50"
              >
                {digit}
              </button>
            ))}
            <div /> {/* empty cell */}
            <button
              onClick={() => handlePinDigit('0')}
              disabled={loading}
              className="h-16 rounded-2xl bg-gray-100 text-2xl font-bold text-gray-900 hover:bg-gray-200 active:bg-gray-300 transition-colors disabled:opacity-50"
            >
              0
            </button>
            <button
              onClick={handlePinDelete}
              disabled={loading}
              className="h-16 rounded-2xl bg-gray-100 text-gray-500 hover:bg-gray-200 active:bg-gray-300 transition-colors flex items-center justify-center disabled:opacity-50"
            >
              <Delete className="h-6 w-6" />
            </button>
          </div>

          {loading && (
            <div className="mt-6">
              <LoadingSpinner label="Authenticating..." />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- Authenticated Screen ----
  return (
    <div className="flex flex-col items-center min-h-[80vh] py-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="rounded-3xl bg-white p-6 shadow-xl mb-6 text-center">
          <Coffee className="mx-auto h-12 w-12 text-primary mb-3" />
          <h2 className="text-3xl font-bold text-gray-900">
            Hello, {session.user.first_name}!
          </h2>
          <p className="text-lg text-gray-500 mt-1">
            {session.active_clock
              ? onBreak
                ? 'You are on break'
                : 'You are clocked in'
              : 'You are clocked out'}
          </p>
          {session.active_clock && (
            <p className="text-sm text-gray-400 mt-1">
              Since {formatTime(session.active_clock.clock_in)}
            </p>
          )}

          {/* Current shift info */}
          {session.today_shifts.length > 0 && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm text-primary">
              <Clock className="h-4 w-4" />
              Today: {session.today_shifts[0].start_time} - {session.today_shifts[0].end_time}
              {session.today_shifts[0].role_label && ` (${session.today_shifts[0].role_label})`}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* Clock In / Clock Out */}
          {!session.active_clock ? (
            <button
              onClick={handleClockIn}
              disabled={actionLoading === 'clockIn'}
              className="flex flex-col items-center justify-center gap-3 rounded-3xl bg-green-500 p-8 text-white shadow-lg hover:bg-green-600 active:bg-green-700 transition-colors disabled:opacity-50"
            >
              <LogIn className="h-12 w-12" />
              <span className="text-xl font-bold">Clock In</span>
            </button>
          ) : (
            <button
              onClick={handleClockOut}
              disabled={actionLoading === 'clockOut'}
              className="flex flex-col items-center justify-center gap-3 rounded-3xl bg-red-500 p-8 text-white shadow-lg hover:bg-red-600 active:bg-red-700 transition-colors disabled:opacity-50"
            >
              <LogOut className="h-12 w-12" />
              <span className="text-xl font-bold">Clock Out</span>
            </button>
          )}

          {/* Break buttons */}
          {session.active_clock && !onBreak ? (
            <>
              <button
                onClick={() => handleStartBreak('paid')}
                disabled={actionLoading === 'break-paid'}
                className="flex flex-col items-center justify-center gap-3 rounded-3xl bg-amber-500 p-8 text-white shadow-lg hover:bg-amber-600 active:bg-amber-700 transition-colors disabled:opacity-50"
              >
                <Coffee className="h-12 w-12" />
                <span className="text-xl font-bold">10 min Break</span>
                <span className="text-sm opacity-80">Paid</span>
              </button>
              <button
                onClick={() => handleStartBreak('unpaid')}
                disabled={actionLoading === 'break-unpaid'}
                className="flex flex-col items-center justify-center gap-3 rounded-3xl bg-orange-500 p-8 text-white shadow-lg hover:bg-orange-600 active:bg-orange-700 transition-colors disabled:opacity-50 col-span-2 sm:col-span-1"
              >
                <Coffee className="h-12 w-12" />
                <span className="text-xl font-bold">30 min Break</span>
                <span className="text-sm opacity-80">Unpaid</span>
              </button>
            </>
          ) : session.active_clock && onBreak ? (
            <button
              onClick={handleEndBreak}
              disabled={actionLoading === 'endBreak'}
              className="flex flex-col items-center justify-center gap-3 rounded-3xl bg-blue-500 p-8 text-white shadow-lg hover:bg-blue-600 active:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Clock className="h-12 w-12" />
              <span className="text-xl font-bold">End Break</span>
            </button>
          ) : (
            <div className="rounded-3xl bg-gray-100 p-8 flex items-center justify-center">
              <p className="text-gray-400 text-center">Clock in to start breaks</p>
            </div>
          )}

          {/* Drawer buttons */}
          <button
            onClick={() => {
              setDrawerStartAmount('');
              setShowDrawerStartModal(true);
            }}
            className="flex flex-col items-center justify-center gap-3 rounded-3xl bg-emerald-500 p-8 text-white shadow-lg hover:bg-emerald-600 active:bg-emerald-700 transition-colors"
          >
            <DollarSign className="h-12 w-12" />
            <span className="text-xl font-bold">Start Drawer</span>
          </button>

          <button
            onClick={() => {
              setDrawerEndAmount('');
              setDrawerEndNotes('');
              setShowDrawerEndModal(true);
            }}
            disabled={!activeDrawer}
            className="flex flex-col items-center justify-center gap-3 rounded-3xl bg-teal-500 p-8 text-white shadow-lg hover:bg-teal-600 active:bg-teal-700 transition-colors disabled:opacity-50"
          >
            <DollarSign className="h-12 w-12" />
            <span className="text-xl font-bold">End Drawer</span>
          </button>

          {/* Unexpected Expense */}
          <button
            onClick={() => {
              setExpenseForm({ amount: '', category: 'CO2 Delivery', notes: '' });
              setShowExpenseModal(true);
            }}
            disabled={!activeDrawer}
            className="flex flex-col items-center justify-center gap-3 rounded-3xl bg-purple-500 p-8 text-white shadow-lg hover:bg-purple-600 active:bg-purple-700 transition-colors disabled:opacity-50"
          >
            <AlertTriangle className="h-12 w-12" />
            <span className="text-xl font-bold">Unexpected Expense</span>
          </button>

          {/* Today's Schedule */}
          <button
            onClick={() => setShowScheduleModal(true)}
            className="flex flex-col items-center justify-center gap-3 rounded-3xl bg-indigo-500 p-8 text-white shadow-lg hover:bg-indigo-600 active:bg-indigo-700 transition-colors"
          >
            <Users className="h-12 w-12" />
            <span className="text-xl font-bold">Today's Schedule</span>
          </button>
        </div>

        {/* Back / Logout */}
        <button
          onClick={() => {
            setSession(null);
            setPin('');
            setActiveDrawer(null);
          }}
          className="w-full rounded-2xl border-2 border-gray-300 py-4 text-lg font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Log Out
        </button>
      </div>

      {/* Expense Modal */}
      <Modal
        open={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
        title="Record Unexpected Expense"
      >
        <div className="space-y-4">
          <Input
            label="Amount ($)"
            type="number"
            step="0.01"
            min="0"
            value={expenseForm.amount}
            onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
            placeholder="0.00"
            className="text-xl"
          />
          <Select
            label="Category"
            options={EXPENSE_CATEGORIES}
            value={expenseForm.category}
            onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
          />
          <Input
            label="Notes"
            value={expenseForm.notes}
            onChange={(e) => setExpenseForm({ ...expenseForm, notes: e.target.value })}
            placeholder="Additional details..."
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowExpenseModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddExpense}
              loading={actionLoading === 'expense'}
              disabled={!expenseForm.amount || parseFloat(expenseForm.amount) <= 0}
            >
              Record Expense
            </Button>
          </div>
        </div>
      </Modal>

      {/* Start Drawer Modal */}
      <Modal
        open={showDrawerStartModal}
        onClose={() => setShowDrawerStartModal(false)}
        title="Start Cash Drawer"
      >
        <div className="space-y-4">
          <Input
            label="Opening Cash Amount ($)"
            type="number"
            step="0.01"
            min="0"
            value={drawerStartAmount}
            onChange={(e) => setDrawerStartAmount(e.target.value)}
            placeholder="0.00"
            className="text-xl"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowDrawerStartModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleStartDrawer}
              loading={actionLoading === 'startDrawer'}
              disabled={!drawerStartAmount || parseFloat(drawerStartAmount) < 0}
            >
              Open Drawer
            </Button>
          </div>
        </div>
      </Modal>

      {/* End Drawer Modal */}
      <Modal
        open={showDrawerEndModal}
        onClose={() => setShowDrawerEndModal(false)}
        title="Close Cash Drawer"
      >
        <div className="space-y-4">
          <Input
            label="Actual Counted Cash ($)"
            type="number"
            step="0.01"
            min="0"
            value={drawerEndAmount}
            onChange={(e) => setDrawerEndAmount(e.target.value)}
            placeholder="0.00"
            className="text-xl"
          />
          <Input
            label="Notes (optional)"
            value={drawerEndNotes}
            onChange={(e) => setDrawerEndNotes(e.target.value)}
            placeholder="Any notes about the drawer..."
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowDrawerEndModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleEndDrawer}
              loading={actionLoading === 'endDrawer'}
              disabled={!drawerEndAmount || parseFloat(drawerEndAmount) < 0}
            >
              Close Drawer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Schedule Modal */}
      <Modal
        open={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        title="Today's Schedule"
        size="lg"
      >
        <div className="space-y-3">
          {todaySchedule.length > 0 ? (
            todaySchedule.map((shift) => (
              <div
                key={shift.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 p-4"
              >
                <div>
                  <p className="text-lg font-semibold text-gray-900">
                    {shift.user
                      ? `${shift.user.first_name} ${shift.user.last_name}`
                      : `Employee #${shift.user_id}`}
                  </p>
                  {shift.role_label && (
                    <p className="text-sm text-gray-500">{shift.role_label}</p>
                  )}
                </div>
                <p className="text-lg font-medium text-gray-700">
                  {shift.start_time} - {shift.end_time}
                </p>
              </div>
            ))
          ) : (
            <p className="text-center text-gray-500 py-8 text-lg">
              No shifts scheduled for today.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
