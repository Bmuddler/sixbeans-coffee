import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Banknote, Plus, X, AlertTriangle, CheckCircle, Receipt, Pencil } from 'lucide-react';
import { formatTime as formatTimePT, todayPacific } from '@/lib/timezone';
import { toast } from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { useAuthStore } from '@/stores/authStore';
import { cashDrawer as cashDrawerApi, locations as locationsApi } from '@/lib/api';
import { UserRole } from '@/types';

const EXPENSE_CATEGORIES = [
  { value: 'CO2 Delivery', label: 'CO2 Delivery' },
  { value: 'Milk Run', label: 'Milk Run' },
  { value: 'Supply Run', label: 'Supply Run' },
  { value: 'Ice Run', label: 'Ice Run' },
  { value: 'Equipment', label: 'Equipment' },
  { value: 'Maintenance', label: 'Maintenance' },
  { value: 'Other', label: 'Other' },
];

const VARIANCE_THRESHOLD = 5;

export function CashDrawerPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const isOwner = user?.role === UserRole.OWNER;

  const [selectedLocationId, setSelectedLocationId] = useState<number>(
    user?.primary_location_id ?? user?.location_ids?.[0] ?? 0,
  );
  const [openDrawerModal, setOpenDrawerModal] = useState(false);
  const [closeDrawerModal, setCloseDrawerModal] = useState(false);
  const [expenseModal, setExpenseModal] = useState(false);
  const [startingCash, setStartingCash] = useState('');
  const [actualCash, setActualCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [expectedModal, setExpectedModal] = useState(false);
  const [expectedAmount, setExpectedAmount] = useState('');
  const [editModal, setEditModal] = useState(false);
  const [editDrawerId, setEditDrawerId] = useState<number | null>(null);
  const [editOpening, setEditOpening] = useState('');
  const [editExpected, setEditExpected] = useState('');
  const [editActual, setEditActual] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('CO2 Delivery');
  const [expenseNotes, setExpenseNotes] = useState('');
  const [reportStartDate, setReportStartDate] = useState(
    format(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
  );
  const [reportEndDate, setReportEndDate] = useState(
    format(new Date(), 'yyyy-MM-dd'),
  );

  const { data: locationsList } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsApi.list,
  });

  // Auto-select first location
  if (!selectedLocationId && locationsList?.length) {
    setSelectedLocationId(locationsList[0].id);
  }

  const { data: drawerReport, isLoading: reportLoading } = useQuery({
    queryKey: ['cashDrawerReport', selectedLocationId, reportStartDate, reportEndDate],
    queryFn: () =>
      cashDrawerApi.getReport({
        location_id: selectedLocationId || undefined,
        start_date: reportStartDate,
        end_date: reportEndDate,
      }),
  });

  const today = todayPacific();
  const todayDrawers = drawerReport?.filter((d: any) => d.date === today) ?? [];
  const activeDrawer = todayDrawers.find((d: any) => d.actual_closing == null);

  const openMutation = useMutation({
    mutationFn: (data: { location_id: number; opening_amount: number }) =>
      cashDrawerApi.open(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashDrawerReport'] });
      setOpenDrawerModal(false);
      setStartingCash('');
      toast.success('Cash drawer opened');
    },
    onError: () => toast.error('Failed to open drawer'),
  });

  const closeMutation = useMutation({
    mutationFn: (data: { id: number; actual_closing: number; notes?: string }) =>
      cashDrawerApi.close(data.id, { actual_closing: data.actual_closing, notes: data.notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashDrawerReport'] });
      setCloseDrawerModal(false);
      setActualCash('');
      setCloseNotes('');
      toast.success('Cash drawer closed');
    },
    onError: () => toast.error('Failed to close drawer'),
  });

  const editMutation = useMutation({
    mutationFn: (data: { id: number; opening_amount?: number; expected_closing?: number; actual_closing?: number; notes?: string }) =>
      cashDrawerApi.edit(data.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashDrawerReport'] });
      setEditModal(false);
      toast.success('Drawer updated');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail ?? 'Failed to update drawer';
      toast.error(msg);
    },
  });

  const expectedMutation = useMutation({
    mutationFn: (data: { id: number; expected_closing: number }) =>
      cashDrawerApi.setExpected(data.id, data.expected_closing),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashDrawerReport'] });
      setExpectedModal(false);
      setExpectedAmount('');
      toast.success('Expected amount set');
    },
    onError: () => toast.error('Failed to set expected amount'),
  });

  const expenseMutation = useMutation({
    mutationFn: (data: { id: number; category: string; amount: number; notes?: string }) =>
      cashDrawerApi.addExpense(data.id, { category: data.category, amount: data.amount, notes: data.notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashDrawerReport'] });
      setExpenseModal(false);
      setExpenseAmount('');
      setExpenseCategory('CO2 Delivery');
      setExpenseNotes('');
      toast.success('Expense recorded');
    },
    onError: () => toast.error('Failed to add expense'),
  });

  const handleOpenDrawer = () => {
    const amount = parseFloat(startingCash);
    if (isNaN(amount) || amount < 0) {
      toast.error('Enter a valid starting amount');
      return;
    }
    const locId = selectedLocationId || locationsList?.[0]?.id;
    if (!locId) {
      toast.error('Select a location');
      return;
    }
    openMutation.mutate({ location_id: locId, opening_amount: amount });
  };

  const handleCloseDrawer = () => {
    if (!activeDrawer) return;
    const amount = parseFloat(actualCash);
    if (isNaN(amount) || amount < 0) {
      toast.error('Enter a valid amount');
      return;
    }
    closeMutation.mutate({ id: activeDrawer.id, actual_closing: amount, notes: closeNotes || undefined });
  };

  const openEditDrawer = (d: any) => {
    setEditDrawerId(d.id);
    setEditOpening(d.opening_amount?.toString() ?? '');
    setEditExpected(d.expected_closing?.toString() ?? '');
    setEditActual(d.actual_closing?.toString() ?? '');
    setEditNotes(d.notes ?? '');
    setEditModal(true);
  };

  const handleEditDrawer = () => {
    if (!editDrawerId) return;
    const data: any = {};
    if (editOpening) data.opening_amount = parseFloat(editOpening);
    if (editExpected) data.expected_closing = parseFloat(editExpected);
    if (editActual) data.actual_closing = parseFloat(editActual);
    if (editNotes !== undefined) data.notes = editNotes || null;
    editMutation.mutate({ id: editDrawerId, ...data });
  };

  const handleSetExpected = () => {
    if (!activeDrawer) return;
    const amount = parseFloat(expectedAmount);
    if (isNaN(amount) || amount < 0) {
      toast.error('Enter a valid expected amount');
      return;
    }
    expectedMutation.mutate({ id: activeDrawer.id, expected_closing: amount });
  };

  const handleAddExpense = () => {
    if (!activeDrawer) return;
    const amount = parseFloat(expenseAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Enter a valid expense amount');
      return;
    }
    expenseMutation.mutate({ id: activeDrawer.id, category: expenseCategory, amount, notes: expenseNotes || undefined });
  };

  const locationOptions = (locationsList ?? []).map((loc) => ({ value: loc.id, label: loc.name }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cash Drawer</h1>
          <p className="page-subtitle">Open, close, and manage cash drawers.</p>
        </div>
        {isOwner && locationOptions.length > 0 && (
          <Select
            options={[{ value: 0, label: 'All Locations' }, ...locationOptions]}
            value={selectedLocationId}
            onChange={(e) => setSelectedLocationId(Number(e.target.value))}
            className="w-48"
          />
        )}
      </div>

      {/* Active Drawer / Actions */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="sm:col-span-1">
          <div className="flex flex-col items-center gap-3 text-center">
            <Banknote className="h-10 w-10 text-primary" />
            {activeDrawer ? (
              <>
                <p className="text-sm text-gray-500">Drawer Open</p>
                <p className="text-lg font-semibold">
                  ${(activeDrawer.opening_amount ?? 0).toFixed(2)}
                </p>
                <p className="text-xs text-gray-400">
                  Opened {formatTimePT(activeDrawer.created_at)}
                  {activeDrawer.employee_name && ` by ${activeDrawer.employee_name}`}
                </p>
                {activeDrawer.expected_closing != null && (
                  <p className="text-sm text-blue-600 font-medium mt-1">
                    Expected: ${activeDrawer.expected_closing.toFixed(2)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button size="sm" variant="secondary" onClick={() => { setExpectedAmount(activeDrawer.expected_closing?.toString() ?? ''); setExpectedModal(true); }}>
                    {activeDrawer.expected_closing != null ? 'Update Expected' : 'Set Expected'}
                  </Button>
                  <Button size="sm" onClick={() => setExpenseModal(true)} icon={<Receipt className="h-4 w-4" />}>
                    Log Expense
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setCloseDrawerModal(true)} icon={<X className="h-4 w-4" />}>
                    Close Drawer
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500">No drawer open</p>
                <Button size="sm" onClick={() => setOpenDrawerModal(true)} icon={<Plus className="h-4 w-4" />}>
                  Start Drawer
                </Button>
              </>
            )}
          </div>
        </Card>

        {/* Today's Summary */}
        <Card title="Today's Summary" className="sm:col-span-2">
          {todayDrawers.length > 0 ? (
            <div className="space-y-3">
              {todayDrawers.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                  <div>
                    <p className="text-sm font-medium">
                      {formatTimePT(d.created_at)}
                      {d.actual_closing != null ? ' (Closed)' : ' (Open)'}
                    </p>
                    <p className="text-xs text-gray-500">{d.employee_name ?? 'Unknown'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm">Opening: ${(d.opening_amount ?? 0).toFixed(2)}</p>
                      {d.variance != null && (
                        <p className={`text-xs font-semibold ${Math.abs(d.variance) > VARIANCE_THRESHOLD ? 'text-red-600' : 'text-green-600'}`}>
                          Variance: {d.variance >= 0 ? '+' : ''}${d.variance.toFixed(2)}
                        </p>
                      )}
                    </div>
                    <button onClick={() => openEditDrawer(d)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Edit">
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              {todayDrawers.some((d: any) => (d.unexpected_expenses?.length ?? 0) > 0) && (
                <div className="mt-2 border-t pt-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Expenses Today</p>
                  {todayDrawers.flatMap((d: any) =>
                    (d.unexpected_expenses ?? []).map((e: any) => (
                      <div key={e.id} className="flex justify-between text-sm py-0.5">
                        <span className="text-gray-700">{e.category}{e.notes ? `: ${e.notes}` : ''}</span>
                        <span className="font-medium">${e.amount.toFixed(2)}</span>
                      </div>
                    )),
                  )}
                </div>
              )}
            </div>
          ) : (
            <EmptyState title="No drawers today" description="No drawers have been opened today." icon={<Banknote className="h-10 w-10" />} />
          )}
        </Card>
      </div>

      {/* Reconciliation Report */}
      <Card
        title="Daily Reconciliation Report"
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)} className="w-36" />
            <span className="text-gray-400">to</span>
            <Input type="date" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)} className="w-36" />
          </div>
        }
      >
        {reportLoading ? (
          <LoadingSpinner label="Loading report..." className="py-8" />
        ) : (drawerReport ?? []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Date', 'Employee', 'Opening', 'Expected', 'Actual', 'Variance', 'Expenses', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {(drawerReport ?? []).map((d: any) => {
                  const expTotal = (d.unexpected_expenses ?? []).reduce((s: number, e: any) => s + e.amount, 0);
                  return (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm">{d.date}</td>
                      <td className="px-4 py-3 text-sm">{d.employee_name ?? '--'}</td>
                      <td className="px-4 py-3 text-sm">${(d.opening_amount ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm">{d.expected_closing != null ? `$${d.expected_closing.toFixed(2)}` : '--'}</td>
                      <td className="px-4 py-3 text-sm">{d.actual_closing != null ? `$${d.actual_closing.toFixed(2)}` : '--'}</td>
                      <td className="px-4 py-3 text-sm">
                        {d.variance != null ? (
                          <span className={`font-semibold ${Math.abs(d.variance) > VARIANCE_THRESHOLD ? 'text-red-600' : 'text-green-600'}`}>
                            {d.variance >= 0 ? '+' : ''}${d.variance.toFixed(2)}
                          </span>
                        ) : '--'}
                      </td>
                      <td className="px-4 py-3 text-sm">{expTotal > 0 ? `$${expTotal.toFixed(2)}` : '--'}</td>
                      <td className="px-4 py-3 text-sm">
                        {d.actual_closing != null ? <Badge variant="approved">Closed</Badge> : <Badge variant="pending">Open</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No records" description="No cash drawer records for the selected period." />
        )}
      </Card>

      {/* Open Drawer Modal */}
      <Modal open={openDrawerModal} onClose={() => setOpenDrawerModal(false)} title="Start Cash Drawer">
        <div className="space-y-4">
          {isOwner && (
            <Select label="Location" options={locationOptions} value={selectedLocationId} onChange={(e) => setSelectedLocationId(Number(e.target.value))} />
          )}
          <Input label="Opening Amount ($)" type="number" step="0.01" min="0" placeholder="0.00" value={startingCash} onChange={(e) => setStartingCash(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpenDrawerModal(false)}>Cancel</Button>
            <Button onClick={handleOpenDrawer} loading={openMutation.isPending}>Open Drawer</Button>
          </div>
        </div>
      </Modal>

      {/* Close Drawer Modal */}
      <Modal open={closeDrawerModal} onClose={() => setCloseDrawerModal(false)} title="Close Cash Drawer">
        <div className="space-y-4">
          {activeDrawer?.expected_closing != null && (
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-sm text-blue-700"><strong>Expected Amount:</strong> ${activeDrawer.expected_closing.toFixed(2)}</p>
            </div>
          )}
          <Input label="Actual Counted Amount ($)" type="number" step="0.01" min="0" placeholder="0.00" value={actualCash} onChange={(e) => setActualCash(e.target.value)} />
          {actualCash && activeDrawer?.expected_closing != null && (() => {
            const diff = parseFloat(actualCash) - activeDrawer.expected_closing;
            const isOver = Math.abs(diff) > VARIANCE_THRESHOLD;
            return (
              <div className={`rounded-lg p-3 ${isOver ? 'bg-red-50' : 'bg-green-50'}`}>
                <p className={`text-sm font-medium ${isOver ? 'text-red-700' : 'text-green-700'}`}>
                  {isOver ? <AlertTriangle className="inline h-4 w-4 mr-1" /> : <CheckCircle className="inline h-4 w-4 mr-1" />}
                  Variance: {diff >= 0 ? '+' : ''}${diff.toFixed(2)}
                </p>
              </div>
            );
          })()}
          <Input label="Notes (optional)" value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="Any notes about the closing..." />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCloseDrawerModal(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleCloseDrawer} loading={closeMutation.isPending}>Close Drawer</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Drawer Modal */}
      <Modal open={editModal} onClose={() => setEditModal(false)} title="Edit Drawer Entry">
        <div className="space-y-4">
          <p className="text-xs text-gray-500">You can only edit entries from today. Changes are logged in the audit trail.</p>
          <Input label="Opening Amount ($)" type="number" step="0.01" value={editOpening} onChange={(e) => setEditOpening(e.target.value)} />
          <Input label="Expected Amount ($)" type="number" step="0.01" value={editExpected} onChange={(e) => setEditExpected(e.target.value)} placeholder="From GoDaddy POS" />
          <Input label="Actual Counted ($)" type="number" step="0.01" value={editActual} onChange={(e) => setEditActual(e.target.value)} />
          <Input label="Notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Reason for edit..." />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditModal(false)}>Cancel</Button>
            <Button onClick={handleEditDrawer} loading={editMutation.isPending}>Save Changes</Button>
          </div>
        </div>
      </Modal>

      {/* Set Expected Amount Modal */}
      <Modal open={expectedModal} onClose={() => setExpectedModal(false)} title="Set Expected Cash Amount">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Enter the expected cash amount from your GoDaddy POS report. This will be used to calculate the variance when closing the drawer.
          </p>
          <Input label="Expected Amount ($)" type="number" step="0.01" min="0" placeholder="0.00" value={expectedAmount} onChange={(e) => setExpectedAmount(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setExpectedModal(false)}>Cancel</Button>
            <Button onClick={handleSetExpected} loading={expectedMutation.isPending}>Save Expected Amount</Button>
          </div>
        </div>
      </Modal>

      {/* Expense Modal */}
      <Modal open={expenseModal} onClose={() => setExpenseModal(false)} title="Log Unexpected Expense">
        <div className="space-y-4">
          <Input label="Amount ($)" type="number" step="0.01" min="0.01" placeholder="0.00" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} />
          <Select label="Category" options={EXPENSE_CATEGORIES} value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} />
          <Input label="Notes (optional)" value={expenseNotes} onChange={(e) => setExpenseNotes(e.target.value)} placeholder="Additional details..." />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setExpenseModal(false)}>Cancel</Button>
            <Button onClick={handleAddExpense} loading={expenseMutation.isPending}>Add Expense</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
