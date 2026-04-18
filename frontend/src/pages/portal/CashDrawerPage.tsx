import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Banknote, Plus, X, AlertTriangle, CheckCircle, Receipt } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { useAuthStore } from '@/stores/authStore';
import { cashDrawer as cashDrawerApi, locations as locationsApi } from '@/lib/api';
import type { CashDrawer } from '@/types';
import { UserRole } from '@/types';

const EXPENSE_CATEGORIES = [
  { value: 'CO2 Delivery', label: 'CO2 Delivery' },
  { value: 'Supply Run', label: 'Supply Run' },
  { value: 'Equipment', label: 'Equipment' },
  { value: 'Other', label: 'Other' },
];

const VARIANCE_THRESHOLD = 5;

export function CashDrawerPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const isOwner = user?.role === UserRole.OWNER;
  const isManager = user?.role === UserRole.MANAGER;

  const [selectedLocationId, setSelectedLocationId] = useState<number>(
    user?.primary_location_id ?? 0,
  );
  const [openDrawerModal, setOpenDrawerModal] = useState(false);
  const [closeDrawerModal, setCloseDrawerModal] = useState(false);
  const [expenseModal, setExpenseModal] = useState(false);
  const [startingCash, setStartingCash] = useState('');
  const [actualCash, setActualCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
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

  const { data: drawerReport, isLoading: reportLoading } = useQuery({
    queryKey: ['cashDrawerReport', selectedLocationId, reportStartDate, reportEndDate],
    queryFn: () =>
      cashDrawerApi.getReport({
        location_id: isOwner ? (selectedLocationId || undefined) : (user?.primary_location_id ?? undefined),
        start_date: reportStartDate,
        end_date: reportEndDate,
      }),
  });

  const todayDrawers = drawerReport?.filter(
    (d) => format(new Date(d.open_time), 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd'),
  );

  const activeDrawer = todayDrawers?.find((d) => !d.close_time);

  const openMutation = useMutation({
    mutationFn: (data: { location_id: number; starting_cash: number }) =>
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
    mutationFn: (data: { id: number; actual_cash: number; notes?: string }) =>
      cashDrawerApi.close(data.id, { actual_cash: data.actual_cash, notes: data.notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashDrawerReport'] });
      setCloseDrawerModal(false);
      setActualCash('');
      setCloseNotes('');
      toast.success('Cash drawer closed');
    },
    onError: () => toast.error('Failed to close drawer'),
  });

  const expenseMutation = useMutation({
    mutationFn: (data: { id: number; description: string; amount: number }) =>
      cashDrawerApi.addExpense(data.id, { description: data.description, amount: data.amount }),
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
    openMutation.mutate({
      location_id: selectedLocationId || user!.primary_location_id,
      starting_cash: amount,
    });
  };

  const handleCloseDrawer = () => {
    if (!activeDrawer) return;
    const amount = parseFloat(actualCash);
    if (isNaN(amount) || amount < 0) {
      toast.error('Enter a valid amount');
      return;
    }
    closeMutation.mutate({
      id: activeDrawer.id,
      actual_cash: amount,
      notes: closeNotes || undefined,
    });
  };

  const handleAddExpense = () => {
    if (!activeDrawer) return;
    const amount = parseFloat(expenseAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Enter a valid expense amount');
      return;
    }
    const description = expenseNotes
      ? `${expenseCategory}: ${expenseNotes}`
      : expenseCategory;
    expenseMutation.mutate({
      id: activeDrawer.id,
      description,
      amount,
    });
  };

  const locationOptions = (locationsList ?? []).map((loc) => ({
    value: loc.id,
    label: loc.name,
  }));

  const reportColumns: Column<CashDrawer & Record<string, unknown>>[] = [
    {
      key: 'open_time',
      header: 'Date',
      sortable: true,
      render: (row) => format(new Date(row.open_time), 'MMM d, yyyy'),
    },
    {
      key: 'location_name',
      header: 'Location',
      render: (row) => row.location?.name ?? '--',
    },
    {
      key: 'starting_cash',
      header: 'Opening',
      render: (row) => `$${row.starting_cash.toFixed(2)}`,
    },
    {
      key: 'expected_cash',
      header: 'Expected',
      render: (row) =>
        row.expected_cash != null ? `$${row.expected_cash.toFixed(2)}` : '--',
    },
    {
      key: 'actual_cash',
      header: 'Actual',
      render: (row) =>
        row.actual_cash != null ? `$${row.actual_cash.toFixed(2)}` : '--',
    },
    {
      key: 'variance',
      header: 'Variance',
      render: (row) => {
        if (row.variance == null) return '--';
        const v = row.variance;
        const isNeg = v < -VARIANCE_THRESHOLD;
        const isOk = Math.abs(v) <= VARIANCE_THRESHOLD;
        return (
          <span
            className={
              isNeg
                ? 'text-red-600 font-semibold'
                : isOk
                  ? 'text-green-600 font-semibold'
                  : 'text-yellow-600 font-semibold'
            }
          >
            {v >= 0 ? '+' : ''}${v.toFixed(2)}
          </span>
        );
      },
    },
    {
      key: 'expenses_total',
      header: 'Expenses',
      render: (row) => {
        const total = row.expenses?.reduce((s, e) => s + e.amount, 0) ?? 0;
        return total > 0 ? `$${total.toFixed(2)}` : '--';
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
        row.close_time ? (
          <Badge variant="approved">Closed</Badge>
        ) : (
          <Badge variant="pending">Open</Badge>
        ),
    },
  ];

  const tableData = (drawerReport ?? []) as (CashDrawer & Record<string, unknown>)[];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cash Drawer</h1>
          <p className="page-subtitle">Open, close, and manage cash drawers.</p>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && locationOptions.length > 0 && (
            <Select
              options={[{ value: 0, label: 'All Locations' }, ...locationOptions]}
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(Number(e.target.value))}
              className="w-48"
            />
          )}
        </div>
      </div>

      {/* Active Drawer / Actions */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="sm:col-span-1">
          <div className="flex flex-col items-center gap-3 text-center">
            <Banknote className="h-10 w-10 text-primary" />
            {activeDrawer ? (
              <>
                <p className="text-sm text-gray-500">Drawer Open Since</p>
                <p className="text-lg font-semibold">
                  {format(new Date(activeDrawer.open_time), 'h:mm a')}
                </p>
                <p className="text-sm text-gray-500">
                  Starting: ${activeDrawer.starting_cash.toFixed(2)}
                </p>
                <div className="flex gap-2 mt-2">
                  <Button size="sm" onClick={() => setExpenseModal(true)} icon={<Receipt className="h-4 w-4" />}>
                    Log Expense
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setCloseDrawerModal(true)}
                    icon={<X className="h-4 w-4" />}
                  >
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
          {todayDrawers && todayDrawers.length > 0 ? (
            <div className="space-y-3">
              {todayDrawers.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                  <div>
                    <p className="text-sm font-medium">
                      {format(new Date(d.open_time), 'h:mm a')}
                      {d.close_time ? ` - ${format(new Date(d.close_time), 'h:mm a')}` : ' (Open)'}
                    </p>
                    <p className="text-xs text-gray-500">
                      Opened by {d.opener?.first_name ?? 'Unknown'}
                      {d.closer ? ` / Closed by ${d.closer.first_name}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm">Start: ${d.starting_cash.toFixed(2)}</p>
                    {d.variance != null && (
                      <p
                        className={`text-xs font-semibold ${
                          d.variance < -VARIANCE_THRESHOLD
                            ? 'text-red-600'
                            : 'text-green-600'
                        }`}
                      >
                        Variance: {d.variance >= 0 ? '+' : ''}${d.variance.toFixed(2)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {/* Expenses for today */}
              {todayDrawers.some((d) => d.expenses.length > 0) && (
                <div className="mt-2 border-t pt-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Expenses Today</p>
                  {todayDrawers.flatMap((d) =>
                    d.expenses.map((e) => (
                      <div key={e.id} className="flex justify-between text-sm py-0.5">
                        <span className="text-gray-700">{e.description}</span>
                        <span className="font-medium">${e.amount.toFixed(2)}</span>
                      </div>
                    )),
                  )}
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              title="No drawers today"
              description="No drawers have been opened today."
              icon={<Banknote className="h-10 w-10" />}
            />
          )}
        </Card>
      </div>

      {/* Reconciliation Report */}
      <Card
        title="Daily Reconciliation Report"
        actions={
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={reportStartDate}
              onChange={(e) => setReportStartDate(e.target.value)}
              className="w-36"
            />
            <span className="text-gray-400">to</span>
            <Input
              type="date"
              value={reportEndDate}
              onChange={(e) => setReportEndDate(e.target.value)}
              className="w-36"
            />
          </div>
        }
      >
        {reportLoading ? (
          <LoadingSpinner label="Loading report..." className="py-8" />
        ) : tableData.length > 0 ? (
          <DataTable
            columns={reportColumns}
            data={tableData}
            keyExtractor={(row) => row.id}
          />
        ) : (
          <EmptyState
            title="No records"
            description="No cash drawer records for the selected period."
          />
        )}
      </Card>

      {/* Open Drawer Modal */}
      <Modal open={openDrawerModal} onClose={() => setOpenDrawerModal(false)} title="Start Cash Drawer">
        <div className="space-y-4">
          {isOwner && (
            <Select
              label="Location"
              options={locationOptions}
              value={selectedLocationId || user?.primary_location_id}
              onChange={(e) => setSelectedLocationId(Number(e.target.value))}
            />
          )}
          <Input
            label="Opening Amount ($)"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={startingCash}
            onChange={(e) => setStartingCash(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpenDrawerModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleOpenDrawer} loading={openMutation.isPending}>
              Open Drawer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Close Drawer Modal */}
      <Modal open={closeDrawerModal} onClose={() => setCloseDrawerModal(false)} title="Close Cash Drawer">
        <div className="space-y-4">
          {activeDrawer?.expected_cash != null && (
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-sm text-blue-700">
                <strong>Expected Amount (from GoDaddy):</strong> ${activeDrawer.expected_cash.toFixed(2)}
              </p>
            </div>
          )}
          <Input
            label="Actual Counted Amount ($)"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={actualCash}
            onChange={(e) => setActualCash(e.target.value)}
          />
          {actualCash && activeDrawer?.expected_cash != null && (
            <div
              className={`rounded-lg p-3 ${
                Math.abs(parseFloat(actualCash) - activeDrawer.expected_cash) > VARIANCE_THRESHOLD
                  ? 'bg-red-50'
                  : 'bg-green-50'
              }`}
            >
              {(() => {
                const diff = parseFloat(actualCash) - activeDrawer.expected_cash;
                const isOver = Math.abs(diff) > VARIANCE_THRESHOLD;
                return (
                  <p className={`text-sm font-medium ${isOver ? 'text-red-700' : 'text-green-700'}`}>
                    {isOver ? (
                      <AlertTriangle className="inline h-4 w-4 mr-1" />
                    ) : (
                      <CheckCircle className="inline h-4 w-4 mr-1" />
                    )}
                    Variance: {diff >= 0 ? '+' : ''}${diff.toFixed(2)}
                  </p>
                );
              })()}
            </div>
          )}
          <Input
            label="Notes (optional)"
            value={closeNotes}
            onChange={(e) => setCloseNotes(e.target.value)}
            placeholder="Any notes about the closing..."
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCloseDrawerModal(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleCloseDrawer} loading={closeMutation.isPending}>
              Close Drawer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Expense Modal */}
      <Modal open={expenseModal} onClose={() => setExpenseModal(false)} title="Log Unexpected Expense">
        <div className="space-y-4">
          <Input
            label="Amount ($)"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={expenseAmount}
            onChange={(e) => setExpenseAmount(e.target.value)}
          />
          <Select
            label="Category"
            options={EXPENSE_CATEGORIES}
            value={expenseCategory}
            onChange={(e) => setExpenseCategory(e.target.value)}
          />
          <Input
            label="Notes (optional)"
            value={expenseNotes}
            onChange={(e) => setExpenseNotes(e.target.value)}
            placeholder="Additional details..."
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setExpenseModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddExpense} loading={expenseMutation.isPending}>
              Add Expense
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
