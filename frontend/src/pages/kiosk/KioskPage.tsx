import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LogIn,
  LogOut,
  Clock,
  DollarSign,
  AlertTriangle,
  Delete,
  Users,
  Coffee,
  Receipt,
  Banknote,
  X,
  ShoppingCart,
  Minus,
  Plus,
  Package,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { api, kiosk, locations as locationsApi, cashDrawer as cashDrawerApi, supplyOrders } from '@/lib/api';
import { formatTime as formatTimePT } from '@/lib/timezone';
import type { ScheduledShift, Location } from '@/types';

interface KioskSession {
  session_token: string;
  first_name: string;
  last_name: string;
  active_clock?: { id: number; status: string; clock_in: string } | null;
  today_shifts?: any[];
}

const INACTIVITY_TIMEOUT = 30_000;
const EXPENSE_CATEGORIES = [
  { value: 'CO2 Delivery', label: 'CO2 Delivery' },
  { value: 'Milk Run', label: 'Milk Run' },
  { value: 'Supply Run', label: 'Supply Run' },
  { value: 'Ice Run', label: 'Ice Run' },
  { value: 'Equipment', label: 'Equipment' },
  { value: 'Maintenance', label: 'Maintenance' },
  { value: 'Other', label: 'Other' },
];

export function KioskPage() {
  const [searchParams] = useSearchParams();
  const urlLocationId = searchParams.get('location');

  const [pin, setPin] = useState('');
  const [locationId, setLocationId] = useState<number>(urlLocationId ? parseInt(urlLocationId, 10) : 0);
  const [locationName, setLocationName] = useState('');
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<KioskSession | null>(null);
  const [todaySchedule, setTodaySchedule] = useState<ScheduledShift[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsLoaded, setLocationsLoaded] = useState(false);

  // Drawer state
  const [activeDrawer, setActiveDrawer] = useState<any>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // Modals
  const [showDrawerStartModal, setShowDrawerStartModal] = useState(false);
  const [showDrawerCloseModal, setShowDrawerCloseModal] = useState(false);
  const [showExpectedModal, setShowExpectedModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showDrawerReportModal, setShowDrawerReportModal] = useState(false);
  const [showEditDrawerModal, setShowEditDrawerModal] = useState(false);
  const [closedDrawer, setClosedDrawer] = useState<any>(null);
  const [editForm, setEditForm] = useState({ opening_amount: '', expected_closing: '', actual_closing: '', notes: '' });

  // Form states
  const [drawerStartAmount, setDrawerStartAmount] = useState('');
  const [drawerCloseAmount, setDrawerCloseAmount] = useState('');
  const [drawerCloseNotes, setDrawerCloseNotes] = useState('');
  const [expectedAmount, setExpectedAmount] = useState('');
  const [expenseForm, setExpenseForm] = useState({ amount: '', category: 'CO2 Delivery', notes: '' });

  // Supply ordering
  const [showSupplyModal, setShowSupplyModal] = useState(false);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<string[]>([]);
  const [supplyCategory, setSupplyCategory] = useState('');
  const [supplyCart, setSupplyCart] = useState<{ id: number; name: string; price: number; qty: number }[]>([]);
  const [supplyNotes, setSupplyNotes] = useState('');
  const [supplySubmitting, setSupplySubmitting] = useState(false);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load locations (public endpoint, no auth needed)
  useEffect(() => {
    api.get('/kiosk/locations').then((r) => r.data as Location[]).then((locs) => {
      setLocations(locs);
      setLocationsLoaded(true);
      if (urlLocationId) {
        const loc = locs.find((l) => l.id === parseInt(urlLocationId, 10));
        if (loc) { setLocationId(loc.id); setLocationName(loc.name); }
        else if (locs.length > 0) { setLocationId(locs[0].id); setLocationName(locs[0].name); }
      } else if (locs.length > 0) {
        setLocationId(locs[0].id); setLocationName(locs[0].name);
      }
    }).catch(() => setLocationsLoaded(true));
  }, []);

  // Pause timeout when in drawer report, edit, close, expense, expected, or supply modals
  const modalOpen = showDrawerCloseModal || showDrawerReportModal || showEditDrawerModal
    || showExpenseModal || showExpectedModal || showDrawerStartModal || showSupplyModal;

  // Inactivity auto-logout
  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (session && !modalOpen) {
      timerRef.current = setTimeout(() => {
        setSession(null); setPin(''); setActiveDrawer(null); localStorage.removeItem('token');
        toast('Session expired');
      }, INACTIVITY_TIMEOUT);
    }
  }, [session, modalOpen]);

  useEffect(() => {
    if (!session) return;
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [session, resetTimer]);

  // Load schedule + drawer on auth
  useEffect(() => {
    if (session && locationId) {
      kiosk.getTodaySchedule(locationId).then(setTodaySchedule).catch(() => {});
      loadActiveDrawer();
    }
  }, [session, locationId]);

  const loadActiveDrawer = async () => {
    if (!locationId) return;
    try {
      setDrawerLoading(true);
      const today = new Date().toISOString().split('T')[0];
      const drawers = await cashDrawerApi.getReport({ location_id: locationId, start_date: today, end_date: today });
      const open = drawers.find((d: any) => d.actual_closing == null);
      setActiveDrawer(open || null);
    } catch { setActiveDrawer(null); }
    finally { setDrawerLoading(false); }
  };

  // PIN handling
  const handlePinDigit = (digit: string) => { if (pin.length < 4) setPin((p) => p + digit); };
  const handlePinDelete = () => setPin((p) => p.slice(0, -1));

  const handleAuth = async () => {
    if (pin.length < 4) return;
    setLoading(true);
    try {
      const res = await kiosk.authenticate({ pin_code: pin, location_id: locationId }) as any;
      // Set the kiosk session token as the JWT for authenticated API calls
      localStorage.setItem('token', res.session_token);
      const sess: KioskSession = {
        session_token: res.session_token,
        first_name: res.first_name,
        last_name: res.last_name,
        active_clock: res.active_time_clock ?? null,
        today_shifts: res.shifts ?? [],
      };
      setSession(sess);
      toast.success(`Welcome, ${sess.first_name}!`);
      setPin('');
    } catch {
      toast.error('Invalid PIN');
      setPin('');
    } finally { setLoading(false); }
  };

  useEffect(() => { if (pin.length === 4 && !session) handleAuth(); }, [pin]);

  // Clock actions
  const handleClockIn = async () => {
    if (!session) return;
    setActionLoading('clockIn');
    try {
      const res = await kiosk.clockIn({ session_token: session.session_token, location_id: locationId }) as any;
      setSession({ ...session, active_clock: { id: res.time_clock_id, status: 'clocked_in', clock_in: res.clock_in } });
      toast.success('Clocked in!');
    } catch (err: any) { toast.error(err?.response?.data?.detail ?? 'Failed to clock in'); }
    finally { setActionLoading(null); }
  };

  const handleClockOut = async () => {
    if (!session?.active_clock) return;
    setActionLoading('clockOut');
    try {
      await kiosk.clockOut({ session_token: session.session_token, time_clock_id: session.active_clock.id });
      setSession({ ...session, active_clock: null });
      toast.success('Clocked out!');
    } catch (err: any) { toast.error(err?.response?.data?.detail ?? 'Failed to clock out'); }
    finally { setActionLoading(null); }
  };

  const handleStartBreak = async (breakType: 'paid_10' | 'unpaid_30') => {
    if (!session?.active_clock) return;
    setActionLoading(`break-${breakType}`);
    try {
      await kiosk.startBreak({ session_token: session.session_token, time_clock_id: session.active_clock.id, break_type: breakType });
      setSession({ ...session, active_clock: { ...session.active_clock, status: 'on_break' } });
      toast.success(`${breakType === 'paid_10' ? '10 min' : '30 min'} break started!`);
    } catch (err: any) { toast.error(err?.response?.data?.detail ?? 'Failed to start break'); }
    finally { setActionLoading(null); }
  };

  const handleEndBreak = async () => {
    if (!session?.active_clock) return;
    setActionLoading('endBreak');
    try {
      await kiosk.endBreak({ session_token: session.session_token, time_clock_id: session.active_clock.id });
      setSession({ ...session, active_clock: { ...session.active_clock, status: 'clocked_in' } });
      toast.success('Break ended!');
    } catch (err: any) { toast.error(err?.response?.data?.detail ?? 'Failed to end break'); }
    finally { setActionLoading(null); }
  };

  // Drawer actions using real API
  const handleOpenDrawer = async () => {
    setActionLoading('openDrawer');
    try {
      const result = await cashDrawerApi.open({ location_id: locationId, opening_amount: parseFloat(drawerStartAmount) });
      setActiveDrawer(result);
      setShowDrawerStartModal(false);
      setDrawerStartAmount('');
      toast.success('Drawer opened!');
    } catch { toast.error('Failed to open drawer'); }
    finally { setActionLoading(null); }
  };

  const handleSetExpected = async () => {
    if (!activeDrawer) return;
    setActionLoading('setExpected');
    try {
      const result = await cashDrawerApi.setExpected(activeDrawer.id, parseFloat(expectedAmount));
      setActiveDrawer(result);
      setShowExpectedModal(false);
      setExpectedAmount('');
      toast.success('Expected amount set!');
    } catch { toast.error('Failed to set expected'); }
    finally { setActionLoading(null); }
  };

  const handleCloseDrawer = async () => {
    if (!activeDrawer) return;
    setActionLoading('closeDrawer');
    try {
      const result = await cashDrawerApi.close(activeDrawer.id, { actual_closing: parseFloat(drawerCloseAmount), notes: drawerCloseNotes || undefined });
      setClosedDrawer(result);
      setActiveDrawer(null);
      setShowDrawerCloseModal(false);
      setShowDrawerReportModal(true);
      setDrawerCloseAmount('');
      setDrawerCloseNotes('');
      toast.success('Drawer closed!');
    } catch { toast.error('Failed to close drawer'); }
    finally { setActionLoading(null); }
  };

  const handleAddExpense = async () => {
    if (!activeDrawer) return;
    setActionLoading('expense');
    try {
      await cashDrawerApi.addExpense(activeDrawer.id, { category: expenseForm.category, amount: parseFloat(expenseForm.amount), notes: expenseForm.notes || undefined });
      await loadActiveDrawer();
      setShowExpenseModal(false);
      setExpenseForm({ amount: '', category: 'CO2 Delivery', notes: '' });
      toast.success('Expense recorded!');
    } catch { toast.error('Failed to record expense'); }
    finally { setActionLoading(null); }
  };

  const handleEditDrawer = async () => {
    if (!closedDrawer) return;
    setActionLoading('editDrawer');
    try {
      const data: any = {};
      if (editForm.opening_amount) data.opening_amount = parseFloat(editForm.opening_amount);
      if (editForm.expected_closing) data.expected_closing = parseFloat(editForm.expected_closing);
      if (editForm.actual_closing) data.actual_closing = parseFloat(editForm.actual_closing);
      if (editForm.notes) data.notes = editForm.notes;
      const result = await cashDrawerApi.edit(closedDrawer.id, data);
      setClosedDrawer(result);
      setShowEditDrawerModal(false);
      toast.success('Drawer updated!');
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? 'Failed to update drawer';
      toast.error(msg);
    }
    finally { setActionLoading(null); }
  };

  useEffect(() => {
    if (showSupplyModal && catalog.length === 0) {
      supplyOrders.getCatalog().then((data: any) => {
        const cats = data.categories ?? [];
        const flat = cats.flatMap((cat: any) =>
          (cat.items ?? []).map((item: any) => ({ ...item, category: cat.name }))
        );
        setCatalog(flat);
        const names = cats.map((c: any) => c.name).sort();
        setCatalogCategories(names);
        if (names.length > 0 && !supplyCategory) setSupplyCategory(names[0]);
      }).catch(() => toast.error('Failed to load catalog'));
    }
  }, [showSupplyModal]);

  const supplyCategoryItems = catalog.filter((item) => item.category === supplyCategory);
  const supplyCartCount = supplyCart.reduce((sum, c) => sum + c.qty, 0);
  const supplyCartTotal = supplyCart.reduce((sum, c) => sum + c.price * c.qty, 0);

  const addToSupplyCart = (item: any) => {
    setSupplyCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) return prev.map((c) => c.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { id: item.id, name: item.name, price: item.price ?? 0, qty: 1 }];
    });
  };

  const handleSubmitSupplyOrder = async () => {
    if (supplyCart.length === 0) return;
    setSupplySubmitting(true);
    try {
      await supplyOrders.submitOrder({
        location_id: locationId,
        notes: supplyNotes || undefined,
        items: supplyCart.map((c) => ({ supply_item_id: c.id, quantity: c.qty })),
      });
      toast.success('Supply order submitted!');
      setSupplyCart([]);
      setSupplyNotes('');
      setShowSupplyModal(false);
    } catch { toast.error('Failed to submit order'); }
    finally { setSupplySubmitting(false); }
  };

  const onBreak = session?.active_clock?.status === 'on_break';
  const lockedToLocation = !!urlLocationId;

  // ---- PIN Screen ----
  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
          <div className="text-center mb-6">
            <img src="/logo.png" alt="Six Beans" className="h-16 w-auto mx-auto mb-4" />
            {locationName && (
              <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-2" style={{ backgroundColor: '#4A3428' }}>
                <span className="text-sm font-semibold uppercase tracking-wide text-white/70">Location</span>
                <span className="text-base font-bold text-white">{locationName}</span>
              </div>
            )}
            <p className="text-gray-500 mt-1">Enter your 4-digit PIN</p>
          </div>

          {!lockedToLocation && locationsLoaded && locations.length > 1 && (
            <div className="mb-4">
              <Select options={locations.map((l) => ({ value: l.id, label: l.name }))} value={locationId} onChange={(e) => { setLocationId(Number(e.target.value)); setLocationName(locations.find((l) => l.id === Number(e.target.value))?.name ?? ''); }} />
            </div>
          )}

          <div className="flex justify-center gap-4 mb-6">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-14 w-14 rounded-2xl border-2 flex items-center justify-center text-3xl font-bold transition-all ${pin.length > i ? 'border-green-500 bg-green-50 text-green-600' : 'border-gray-200 bg-gray-50'}`}>
                {pin.length > i ? '●' : ''}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
            {['1','2','3','4','5','6','7','8','9'].map((d) => (
              <button key={d} onClick={() => handlePinDigit(d)} disabled={loading} className="h-16 rounded-2xl bg-gray-100 text-2xl font-bold text-gray-900 hover:bg-gray-200 active:bg-gray-300 transition-colors disabled:opacity-50">{d}</button>
            ))}
            <div />
            <button onClick={() => handlePinDigit('0')} disabled={loading} className="h-16 rounded-2xl bg-gray-100 text-2xl font-bold text-gray-900 hover:bg-gray-200 active:bg-gray-300 transition-colors disabled:opacity-50">0</button>
            <button onClick={handlePinDelete} disabled={loading} className="h-16 rounded-2xl bg-gray-100 text-gray-500 hover:bg-gray-200 active:bg-gray-300 transition-colors flex items-center justify-center disabled:opacity-50"><Delete className="h-6 w-6" /></button>
          </div>

          {loading && <div className="mt-4"><LoadingSpinner label="Authenticating..." /></div>}
        </div>
      </div>
    );
  }

  // ---- Authenticated Screen ----
  return (
    <div className="flex flex-col items-center min-h-screen py-6" style={{ backgroundColor: '#F5F0E8' }}>
      <div className="w-full max-w-2xl px-4">
        {/* Header */}
        <div className="rounded-3xl bg-white p-6 shadow-xl mb-4 text-center">
          <img src="/logo.png" alt="Six Beans" className="h-10 w-auto mx-auto mb-2" />
          {locationName && <p className="text-xs font-medium text-gray-400 mb-2">{locationName}</p>}
          <h2 className="text-2xl font-bold text-gray-900">Hello, {session.first_name}!</h2>
          <p className="text-sm text-gray-500 mt-1">
            {session.active_clock ? (onBreak ? 'On break' : 'Clocked in') : 'Clocked out'}
            {session.active_clock?.clock_in && ` since ${formatTimePT(session.active_clock.clock_in)}`}
          </p>

          {/* Drawer status */}
          {activeDrawer && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium" style={{ backgroundColor: 'rgba(92,184,50,0.1)', color: '#5CB832' }}>
              <Banknote className="h-4 w-4" />
              Drawer open · ${(activeDrawer.opening_amount ?? 0).toFixed(2)}
              {activeDrawer.expected_closing != null && ` · Expected: $${activeDrawer.expected_closing.toFixed(2)}`}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {!session.active_clock ? (
            <button onClick={handleClockIn} disabled={actionLoading === 'clockIn'} className="flex flex-col items-center justify-center gap-2 rounded-3xl bg-green-500 p-6 text-white shadow-lg hover:bg-green-600 active:bg-green-700 transition-colors disabled:opacity-50">
              <LogIn className="h-10 w-10" /><span className="text-lg font-bold">Clock In</span>
            </button>
          ) : (
            <button onClick={handleClockOut} disabled={actionLoading === 'clockOut'} className="flex flex-col items-center justify-center gap-2 rounded-3xl bg-red-500 p-6 text-white shadow-lg hover:bg-red-600 active:bg-red-700 transition-colors disabled:opacity-50">
              <LogOut className="h-10 w-10" /><span className="text-lg font-bold">Clock Out</span>
            </button>
          )}

          {session.active_clock && !onBreak ? (
            <button onClick={() => handleStartBreak('paid_10')} disabled={actionLoading === 'break-paid_10'} className="flex flex-col items-center justify-center gap-2 rounded-3xl bg-amber-500 p-6 text-white shadow-lg hover:bg-amber-600 transition-colors disabled:opacity-50">
              <Coffee className="h-10 w-10" /><span className="text-lg font-bold">10 min Break</span><span className="text-xs opacity-80">Paid</span>
            </button>
          ) : session.active_clock && onBreak ? (
            <button onClick={handleEndBreak} disabled={actionLoading === 'endBreak'} className="flex flex-col items-center justify-center gap-2 rounded-3xl bg-blue-500 p-6 text-white shadow-lg hover:bg-blue-600 transition-colors disabled:opacity-50">
              <Clock className="h-10 w-10" /><span className="text-lg font-bold">End Break</span>
            </button>
          ) : (
            <div className="rounded-3xl bg-gray-200 p-6 flex items-center justify-center"><p className="text-gray-400 text-center text-sm">Clock in first</p></div>
          )}

          {session.active_clock && !onBreak && (
            <button onClick={() => handleStartBreak('unpaid_30')} disabled={actionLoading === 'break-unpaid_30'} className="flex flex-col items-center justify-center gap-2 rounded-3xl bg-orange-500 p-6 text-white shadow-lg hover:bg-orange-600 transition-colors disabled:opacity-50 col-span-2 sm:col-span-1">
              <Coffee className="h-10 w-10" /><span className="text-lg font-bold">30 min Break</span><span className="text-xs opacity-80">Unpaid</span>
            </button>
          )}

          <button onClick={() => setShowScheduleModal(true)} className="flex flex-col items-center justify-center gap-2 rounded-3xl bg-indigo-500 p-6 text-white shadow-lg hover:bg-indigo-600 transition-colors">
            <Users className="h-10 w-10" /><span className="text-lg font-bold">Schedule</span>
          </button>

          <button onClick={() => setShowSupplyModal(true)} className="flex flex-col items-center justify-center gap-2 rounded-3xl p-6 text-white shadow-lg transition-colors" style={{ backgroundColor: '#5CB832' }}>
            <Package className="h-10 w-10" /><span className="text-lg font-bold">Order Supplies</span>
          </button>
        </div>

        {/* Cash Drawer Section */}
        <div className="rounded-3xl bg-white p-5 shadow-xl mb-4">
          <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2"><Banknote className="h-5 w-5" style={{ color: '#5CB832' }} /> Cash Drawer</h3>
          {!activeDrawer ? (
            <button onClick={() => { setDrawerStartAmount(''); setShowDrawerStartModal(true); }} className="w-full flex items-center justify-center gap-3 rounded-2xl p-5 text-white font-bold text-lg transition-colors" style={{ backgroundColor: '#5CB832' }}>
              <DollarSign className="h-8 w-8" /> Open Drawer
            </button>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: '#F5F0E8' }}>
                <div className="flex justify-between"><span className="text-gray-500">Opening:</span><span className="font-bold">${(activeDrawer.opening_amount ?? 0).toFixed(2)}</span></div>
                {activeDrawer.expected_closing != null && <div className="flex justify-between mt-1"><span className="text-gray-500">Expected:</span><span className="font-bold text-blue-600">${activeDrawer.expected_closing.toFixed(2)}</span></div>}
                {(activeDrawer.unexpected_expenses ?? []).length > 0 && (
                  <div className="flex justify-between mt-1">
                    <span className="text-gray-500">Expenses ({(activeDrawer.unexpected_expenses ?? []).length}):</span>
                    <span className="font-bold text-red-600">
                      -${((activeDrawer.unexpected_expenses ?? []).reduce((s: number, e: any) => s + (e.amount ?? 0), 0)).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => { setExpectedAmount(activeDrawer.expected_closing?.toString() ?? ''); setShowExpectedModal(true); }} className="flex flex-col items-center gap-1 rounded-xl border-2 border-blue-200 bg-blue-50 p-3 text-blue-700 font-semibold text-sm hover:bg-blue-100 transition-colors">
                  <DollarSign className="h-6 w-6" />{activeDrawer.expected_closing != null ? 'Update Expected' : 'Set Expected'}
                </button>
                <button onClick={() => { setExpenseForm({ amount: '', category: 'CO2 Delivery', notes: '' }); setShowExpenseModal(true); }} className="flex flex-col items-center gap-1 rounded-xl border-2 border-purple-200 bg-purple-50 p-3 text-purple-700 font-semibold text-sm hover:bg-purple-100 transition-colors">
                  <Receipt className="h-6 w-6" />Log Expense
                </button>
                <button onClick={() => { setDrawerCloseAmount(''); setDrawerCloseNotes(''); setShowDrawerCloseModal(true); }} className="flex flex-col items-center gap-1 rounded-xl border-2 border-red-200 bg-red-50 p-3 text-red-700 font-semibold text-sm hover:bg-red-100 transition-colors">
                  <X className="h-6 w-6" />Close Drawer
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Logout */}
        <button onClick={() => { setSession(null); setPin(''); setActiveDrawer(null); localStorage.removeItem('token'); }} className="w-full rounded-2xl border-2 border-gray-300 py-3 text-lg font-semibold text-gray-500 hover:bg-white transition-colors">
          Log Out
        </button>
      </div>

      {/* Open Drawer Modal */}
      <Modal open={showDrawerStartModal} onClose={() => setShowDrawerStartModal(false)} title="Open Cash Drawer">
        <div className="space-y-4">
          <Input label="Opening Amount ($)" type="number" step="0.01" min="0" value={drawerStartAmount} onChange={(e) => setDrawerStartAmount(e.target.value)} placeholder="0.00" />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setShowDrawerStartModal(false)}>Cancel</Button><Button onClick={handleOpenDrawer} loading={actionLoading === 'openDrawer'}>Open Drawer</Button></div>
        </div>
      </Modal>

      {/* Set Expected Modal */}
      <Modal open={showExpectedModal} onClose={() => setShowExpectedModal(false)} title="Set Expected Amount">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Enter the expected cash amount from GoDaddy POS.</p>
          <Input label="Expected Amount ($)" type="number" step="0.01" min="0" value={expectedAmount} onChange={(e) => setExpectedAmount(e.target.value)} placeholder="0.00" />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setShowExpectedModal(false)}>Cancel</Button><Button onClick={handleSetExpected} loading={actionLoading === 'setExpected'}>Save</Button></div>
        </div>
      </Modal>

      {/* Close Drawer Modal - shows full report before submitting */}
      <Modal open={showDrawerCloseModal} onClose={() => setShowDrawerCloseModal(false)} title="Close Cash Drawer" size="lg">
        {activeDrawer && (
          <div className="space-y-4">
            {/* Full report preview */}
            <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-sm text-gray-500">Opening Amount</span>
                <span className="text-sm font-bold">${(activeDrawer.opening_amount ?? 0).toFixed(2)}</span>
              </div>
              {activeDrawer.expected_closing != null && (
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-sm text-gray-500">Expected (GoDaddy)</span>
                  <span className="text-sm font-bold text-blue-600">${activeDrawer.expected_closing.toFixed(2)}</span>
                </div>
              )}
              {(activeDrawer.unexpected_expenses ?? []).length > 0 && (
                <>
                  <div className="px-4 py-2 bg-gray-50">
                    <span className="text-xs font-semibold text-gray-500 uppercase">Expenses</span>
                  </div>
                  {(activeDrawer.unexpected_expenses ?? []).map((exp: any, i: number) => (
                    <div key={i} className="flex justify-between px-4 py-2">
                      <span className="text-sm text-gray-600">{exp.category}{exp.notes ? ` - ${exp.notes}` : ''}</span>
                      <span className="text-sm font-medium text-red-600">-${(exp.amount ?? 0).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between px-4 py-2.5 bg-red-50">
                    <span className="text-sm font-medium text-red-700">Total Expenses</span>
                    <span className="text-sm font-bold text-red-700">
                      -${((activeDrawer.unexpected_expenses ?? []).reduce((s: number, e: any) => s + (e.amount ?? 0), 0)).toFixed(2)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Actual count input */}
            <Input label="Actual Cash Counted ($)" type="number" step="0.01" min="0" value={drawerCloseAmount} onChange={(e) => setDrawerCloseAmount(e.target.value)} placeholder="0.00" />

            {/* Preview variance */}
            {drawerCloseAmount && activeDrawer.expected_closing != null && (
              <div className={`rounded-lg p-3 text-center ${
                parseFloat(drawerCloseAmount) - activeDrawer.expected_closing >= 0 ? 'bg-green-50' : 'bg-red-50'
              }`}>
                <span className="text-sm font-medium">Variance: </span>
                <span className={`text-lg font-bold ${
                  parseFloat(drawerCloseAmount) - activeDrawer.expected_closing >= 0 ? 'text-green-700' : 'text-red-700'
                }`}>
                  ${(parseFloat(drawerCloseAmount) - activeDrawer.expected_closing).toFixed(2)}
                </span>
              </div>
            )}

            <Input label="Notes (optional)" value={drawerCloseNotes} onChange={(e) => setDrawerCloseNotes(e.target.value)} placeholder="Any notes..." />

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowDrawerCloseModal(false)}>Cancel</Button>
              <Button variant="danger" onClick={handleCloseDrawer} loading={actionLoading === 'closeDrawer'} disabled={!drawerCloseAmount}>Close Drawer</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Drawer Report Modal - shown after closing */}
      <Modal open={showDrawerReportModal} onClose={() => { setShowDrawerReportModal(false); setClosedDrawer(null); }} title="Drawer Report" size="lg">
        {closedDrawer && (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-sm text-gray-500">Opening Amount</span>
                <span className="text-sm font-bold">${(closedDrawer.opening_amount ?? 0).toFixed(2)}</span>
              </div>
              {closedDrawer.expected_closing != null && (
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-sm text-gray-500">Expected (GoDaddy)</span>
                  <span className="text-sm font-bold text-blue-600">${closedDrawer.expected_closing.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-sm text-gray-500">Actual Counted</span>
                <span className="text-sm font-bold">${(closedDrawer.actual_closing ?? 0).toFixed(2)}</span>
              </div>
              {(closedDrawer.unexpected_expenses ?? []).length > 0 && (
                <>
                  <div className="px-4 py-2 bg-gray-50">
                    <span className="text-xs font-semibold text-gray-500 uppercase">Expenses</span>
                  </div>
                  {(closedDrawer.unexpected_expenses ?? []).map((exp: any, i: number) => (
                    <div key={i} className="flex justify-between px-4 py-2">
                      <span className="text-sm text-gray-600">{exp.category}{exp.notes ? ` - ${exp.notes}` : ''}</span>
                      <span className="text-sm font-medium text-red-600">-${(exp.amount ?? 0).toFixed(2)}</span>
                    </div>
                  ))}
                </>
              )}
              {closedDrawer.variance != null && (
                <div className={`flex justify-between px-4 py-3 ${closedDrawer.variance >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                  <span className="text-sm font-semibold">Variance</span>
                  <span className={`text-lg font-bold ${closedDrawer.variance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    ${closedDrawer.variance.toFixed(2)}
                  </span>
                </div>
              )}
              {closedDrawer.notes && (
                <div className="px-4 py-2.5">
                  <span className="text-xs text-gray-400">Notes:</span>
                  <p className="text-sm text-gray-700">{closedDrawer.notes}</p>
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => {
                setEditForm({
                  opening_amount: (closedDrawer.opening_amount ?? '').toString(),
                  expected_closing: (closedDrawer.expected_closing ?? '').toString(),
                  actual_closing: (closedDrawer.actual_closing ?? '').toString(),
                  notes: closedDrawer.notes ?? '',
                });
                setShowEditDrawerModal(true);
              }}>
                Edit Report
              </Button>
              <Button onClick={() => { setShowDrawerReportModal(false); setClosedDrawer(null); }}>Done</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Drawer Modal */}
      <Modal open={showEditDrawerModal} onClose={() => setShowEditDrawerModal(false)} title="Edit Drawer Report">
        <div className="space-y-4">
          <Input label="Opening Amount ($)" type="number" step="0.01" value={editForm.opening_amount} onChange={(e) => setEditForm((f) => ({ ...f, opening_amount: e.target.value }))} />
          <Input label="Expected Amount ($)" type="number" step="0.01" value={editForm.expected_closing} onChange={(e) => setEditForm((f) => ({ ...f, expected_closing: e.target.value }))} />
          <Input label="Actual Counted ($)" type="number" step="0.01" value={editForm.actual_closing} onChange={(e) => setEditForm((f) => ({ ...f, actual_closing: e.target.value }))} />
          <Input label="Notes" value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
          <p className="text-xs text-gray-400">Editing is only allowed for today's drawer reports.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowEditDrawerModal(false)}>Cancel</Button>
            <Button onClick={handleEditDrawer} loading={actionLoading === 'editDrawer'}>Save Changes</Button>
          </div>
        </div>
      </Modal>

      {/* Expense Modal */}
      <Modal open={showExpenseModal} onClose={() => setShowExpenseModal(false)} title="Log Expense">
        <div className="space-y-4">
          <Input label="Amount ($)" type="number" step="0.01" min="0" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} placeholder="0.00" />
          <Select label="Category" options={EXPENSE_CATEGORIES} value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })} />
          <Input label="Notes (optional)" value={expenseForm.notes} onChange={(e) => setExpenseForm({ ...expenseForm, notes: e.target.value })} placeholder="Details..." />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setShowExpenseModal(false)}>Cancel</Button><Button onClick={handleAddExpense} loading={actionLoading === 'expense'}>Record</Button></div>
        </div>
      </Modal>

      {/* Schedule Modal */}
      <Modal open={showScheduleModal} onClose={() => setShowScheduleModal(false)} title="Today's Schedule" size="lg">
        <div className="space-y-2">
          {todaySchedule.length > 0 ? todaySchedule.map((shift: any) => (
            <div key={shift.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
              <div>
                <p className="font-semibold text-gray-900">{shift.employee_name ?? `Employee #${shift.employee_id}`}</p>
              </div>
              <p className="font-medium text-gray-700">{formatTimePT(shift.start_time)} - {formatTimePT(shift.end_time)}</p>
            </div>
          )) : <p className="text-center text-gray-500 py-8">No shifts scheduled today.</p>}
        </div>
      </Modal>

      {/* Supply Order Modal */}
      <Modal open={showSupplyModal} onClose={() => setShowSupplyModal(false)} title="Order Supplies" size="lg">
        <div className="space-y-4">
          {/* Category tabs */}
          <div className="flex gap-1 overflow-x-auto pb-1">
            {catalogCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSupplyCategory(cat)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex-shrink-0 ${
                  supplyCategory === cat ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Items */}
          <div className="max-h-[40vh] overflow-y-auto divide-y divide-gray-100 border rounded-lg">
            {supplyCategoryItems.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No items</p>
            ) : supplyCategoryItems.map((item: any) => {
              const inCart = supplyCart.find((c) => c.id === item.id);
              return (
                <div key={item.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{item.name}</p>
                    <p className="text-xs text-gray-500">{item.description} {item.price != null ? `· $${item.price.toFixed(2)}` : ''}</p>
                  </div>
                  {inCart ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => setSupplyCart((prev) => prev.map((c) => c.id === item.id ? { ...c, qty: Math.max(1, c.qty - 1) } : c))} className="h-7 w-7 flex items-center justify-center rounded border border-gray-300">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-8 text-center text-sm font-medium">{inCart.qty}</span>
                      <button onClick={() => setSupplyCart((prev) => prev.map((c) => c.id === item.id ? { ...c, qty: c.qty + 1 } : c))} className="h-7 w-7 flex items-center justify-center rounded border border-gray-300">
                        <Plus className="h-3 w-3" />
                      </button>
                      <button onClick={() => setSupplyCart((prev) => prev.filter((c) => c.id !== item.id))} className="ml-1 h-7 w-7 flex items-center justify-center rounded text-red-400 hover:text-red-600">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => addToSupplyCart(item)} className="px-3 py-1 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: '#5CB832' }}>
                      Add
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Cart summary */}
          {supplyCart.length > 0 && (
            <div className="rounded-lg bg-gray-50 p-3 space-y-2">
              <div className="flex justify-between text-sm font-medium">
                <span>{supplyCartCount} items</span>
                <span className="text-green-600">${supplyCartTotal.toFixed(2)}</span>
              </div>
              <div className="text-xs text-gray-500 space-y-0.5">
                {supplyCart.map((c) => (
                  <div key={c.id} className="flex justify-between">
                    <span>{c.name} x{c.qty}</span>
                    <span>${(c.price * c.qty).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <Input placeholder="Notes (optional)" value={supplyNotes} onChange={(e) => setSupplyNotes(e.target.value)} />
              <Button className="w-full" onClick={handleSubmitSupplyOrder} loading={supplySubmitting}>
                Submit Order
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
