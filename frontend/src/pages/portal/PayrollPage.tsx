import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns';
import {
  DollarSign,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Download,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { payroll as payrollApi, locations as locationsApi } from '@/lib/api';
import type { PayrollRecord, PayrollStatus } from '@/types';

const STATUS_BADGE_MAP: Record<string, 'pending' | 'approved' | 'info' | 'denied'> = {
  draft: 'pending',
  generated: 'pending',
  ai_reviewed: 'info',
  approved: 'approved',
  exported: 'approved',
};

function getStatusBadge(status: string) {
  return (
    <Badge variant={STATUS_BADGE_MAP[status] ?? 'info'}>
      {status.replace('_', ' ').toUpperCase()}
    </Badge>
  );
}

export function PayrollPage() {
  const queryClient = useQueryClient();

  const [weekOffset, setWeekOffset] = useState(0);
  const currentWeekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const currentWeekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
  const periodStart = format(currentWeekStart, 'yyyy-MM-dd');
  const periodEnd = format(currentWeekEnd, 'yyyy-MM-dd');

  const [selectedLocationId, setSelectedLocationId] = useState<number>(0);
  const [approveModal, setApproveModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [aiResults, setAiResults] = useState<{ issues: string[]; summary: string } | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [adpPreviewData, setAdpPreviewData] = useState<{
    period_start: string;
    period_end: string;
    employees: { name: string; adp_code: string; department: string; location: string; regular_hours: number; overtime_hours: number; total_hours: number }[];
    warnings: string[];
    total_regular: number;
    total_overtime: number;
  } | null>(null);
  const [adpModalOpen, setAdpModalOpen] = useState(false);

  const { data: locationsList } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsApi.list,
  });

  const locationOptions = [
    { value: 0, label: 'All Locations' },
    ...(locationsList ?? []).map((loc) => ({ value: loc.id, label: loc.name })),
  ];

  const generateMutation = useMutation({
    mutationFn: () =>
      payrollApi.generate({
        location_id: selectedLocationId || (locationsList?.[0]?.id ?? 1),
        period_start: periodStart,
        period_end: periodEnd,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      toast.success('Payroll records generated');
    },
    onError: () => toast.error('Failed to generate payroll'),
  });

  // We reuse the generate endpoint to fetch records for the period
  // In practice the backend would return existing records if already generated
  const { data: payrollRecords, isLoading } = useQuery({
    queryKey: ['payroll', periodStart, periodEnd, selectedLocationId],
    queryFn: () =>
      payrollApi.generate({
        location_id: selectedLocationId || (locationsList?.[0]?.id ?? 1),
        period_start: periodStart,
        period_end: periodEnd,
      }),
    enabled: false, // We only fetch when user clicks generate
  });

  const aiValidateMutation = useMutation({
    mutationFn: () =>
      payrollApi.aiValidate({
        period_start: periodStart,
        period_end: periodEnd,
        location_id: selectedLocationId || undefined,
      }),
    onSuccess: (data) => {
      setAiResults(data);
      setAiModalOpen(true);
      toast.success('AI validation complete');
    },
    onError: () => toast.error('AI validation failed'),
  });

  const approveMutation = useMutation({
    mutationFn: (ids: number[]) => payrollApi.approve(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      setApproveModal(false);
      setSelectedIds([]);
      toast.success('Payroll approved');
    },
    onError: () => toast.error('Failed to approve payroll'),
  });

  const handleExport = async () => {
    try {
      const blob = await payrollApi.exportCsv({
        period_start: periodStart,
        period_end: periodEnd,
        location_id: selectedLocationId || undefined,
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll_${periodStart}_${periodEnd}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('CSV exported');
    } catch {
      toast.error('Export failed');
    }
  };

  const adpPreviewMutation = useMutation({
    mutationFn: () =>
      payrollApi.adpPreview({ period_start: periodStart, period_end: periodEnd }),
    onSuccess: (data: any) => {
      setAdpPreviewData(data);
      setAdpModalOpen(true);
    },
    onError: () => toast.error('Failed to load ADP preview'),
  });

  const handleAdpExport = async () => {
    try {
      await payrollApi.adpExport({ period_start: periodStart, period_end: periodEnd });
      toast.success('ADP CSV downloaded');
    } catch {
      toast.error('ADP export failed');
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const toggleAll = () => {
    if (!payrollRecords) return;
    if (selectedIds.length === payrollRecords.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(payrollRecords.map((r) => r.id));
    }
  };

  const columns: Column<PayrollRecord & Record<string, unknown>>[] = [
    {
      key: 'select',
      header: '',
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.includes(row.id)}
          onChange={() => toggleSelect(row.id)}
          className="h-4 w-4 rounded border-gray-300"
        />
      ),
      className: 'w-10',
    },
    {
      key: 'employee',
      header: 'Employee',
      render: (row) =>
        row.user ? `${row.user.first_name} ${row.user.last_name}` : `User #${row.user_id}`,
      sortable: true,
    },
    {
      key: 'regular_hours',
      header: 'Regular Hrs',
      sortable: true,
      render: (row) => row.regular_hours.toFixed(1),
    },
    {
      key: 'overtime_hours',
      header: 'OT Hrs',
      sortable: true,
      render: (row) => row.overtime_hours.toFixed(1),
    },
    {
      key: 'break_deductions',
      header: 'Break Deductions',
      render: () => '--',
    },
    {
      key: 'total_hours',
      header: 'Total Hrs',
      render: (row) => (row.regular_hours + row.overtime_hours).toFixed(1),
      sortable: true,
    },
    {
      key: 'total_pay',
      header: 'Total Pay',
      render: (row) => `$${row.total_pay.toFixed(2)}`,
      sortable: true,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => getStatusBadge(row.status),
    },
  ];

  const records = (payrollRecords ?? []) as (PayrollRecord & Record<string, unknown>)[];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll</h1>
          <p className="page-subtitle">Generate, review, and export payroll records.</p>
        </div>
      </div>

      {/* Period Selector */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWeekOffset((w) => w - 1)}
              icon={<ChevronLeft className="h-4 w-4" />}
            />
            <div className="text-center">
              <p className="text-sm text-gray-500">Pay Period</p>
              <p className="text-lg font-semibold">
                {format(currentWeekStart, 'MMM d')} - {format(currentWeekEnd, 'MMM d, yyyy')}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWeekOffset((w) => w + 1)}
              disabled={weekOffset >= 0}
              icon={<ChevronRight className="h-4 w-4" />}
            />
          </div>

          <div className="flex items-center gap-2">
            <Select
              options={locationOptions}
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(Number(e.target.value))}
              className="w-44"
            />
            <Button
              onClick={() => generateMutation.mutate()}
              loading={generateMutation.isPending}
              icon={<DollarSign className="h-4 w-4" />}
            >
              Generate Payroll
            </Button>
          </div>
        </div>
      </Card>

      {/* Actions Bar */}
      {records.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => aiValidateMutation.mutate()}
            loading={aiValidateMutation.isPending}
            icon={<Sparkles className="h-4 w-4" />}
          >
            Claude AI Validation
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (selectedIds.length === 0) {
                toast.error('Select records to approve');
                return;
              }
              setApproveModal(true);
            }}
            icon={<CheckCircle className="h-4 w-4" />}
          >
            Approve Selected ({selectedIds.length})
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            icon={<Download className="h-4 w-4" />}
          >
            Export CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => adpPreviewMutation.mutate()}
            loading={adpPreviewMutation.isPending}
            icon={<DollarSign className="h-4 w-4" />}
          >
            ADP Preview
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleAdpExport}
            icon={<Download className="h-4 w-4" />}
          >
            ADP Export CSV
          </Button>
          <button
            onClick={toggleAll}
            className="ml-auto text-sm text-primary hover:underline"
          >
            {selectedIds.length === records.length ? 'Deselect All' : 'Select All'}
          </button>
        </div>
      )}

      {/* Payroll Table */}
      <Card padding={false}>
        {generateMutation.isPending ? (
          <LoadingSpinner label="Generating payroll..." className="py-12" />
        ) : records.length > 0 ? (
          <DataTable
            columns={columns}
            data={records}
            keyExtractor={(row) => row.id}
          />
        ) : (
          <EmptyState
            icon={<DollarSign className="h-12 w-12" />}
            title="No Payroll Records"
            description="Click 'Generate Payroll' to create records from time clock data for this period."
          />
        )}
      </Card>

      {/* Approval History */}
      {records.filter((r) => r.status === 'approved' || r.status === 'exported').length > 0 && (
        <Card title="Approval History" className="mt-6">
          <div className="space-y-2">
            {records
              .filter((r) => r.status === 'approved' || r.status === 'exported')
              .map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                  <div>
                    <p className="text-sm font-medium">
                      {r.user ? `${r.user.first_name} ${r.user.last_name}` : `User #${r.user_id}`}
                    </p>
                    <p className="text-xs text-gray-500">
                      Approved by User #{r.approved_by ?? 'Unknown'} on{' '}
                      {format(new Date(r.created_at), 'MMM d, yyyy h:mm a')}
                    </p>
                  </div>
                  {getStatusBadge(r.status)}
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Approve Confirmation Modal */}
      <Modal open={approveModal} onClose={() => setApproveModal(false)} title="Approve Payroll">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            You are about to approve <strong>{selectedIds.length}</strong> payroll record(s) for the period{' '}
            <strong>{format(currentWeekStart, 'MMM d')} - {format(currentWeekEnd, 'MMM d, yyyy')}</strong>.
          </p>
          <p className="text-sm text-gray-500">
            This action cannot be undone. Approved records can be exported to ADP.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setApproveModal(false)}>
              Cancel
            </Button>
            <Button onClick={() => approveMutation.mutate(selectedIds)} loading={approveMutation.isPending}>
              Confirm Approval
            </Button>
          </div>
        </div>
      </Modal>

      {/* AI Validation Results Modal */}
      <Modal open={aiModalOpen} onClose={() => setAiModalOpen(false)} title="Claude AI Validation Results" size="lg">
        {aiResults && (
          <div className="space-y-4">
            <div className="rounded-lg bg-blue-50 p-4">
              <p className="text-sm font-medium text-blue-800">Summary</p>
              <p className="mt-1 text-sm text-blue-700">{aiResults.summary}</p>
            </div>
            {aiResults.issues.length > 0 ? (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  <AlertTriangle className="inline h-4 w-4 text-yellow-500 mr-1" />
                  Issues Found ({aiResults.issues.length})
                </p>
                <ul className="space-y-2">
                  {aiResults.issues.map((issue, i) => (
                    <li key={i} className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle className="h-5 w-5" />
                <p className="text-sm font-medium">No issues found. Payroll looks good!</p>
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={() => setAiModalOpen(false)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ADP Preview Modal */}
      <Modal open={adpModalOpen} onClose={() => setAdpModalOpen(false)} title="ADP Payroll Preview" size="lg">
        {adpPreviewData && (
          <div className="space-y-4">
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-sm text-gray-600">
                Period: <strong>{adpPreviewData.period_start}</strong> - <strong>{adpPreviewData.period_end}</strong>
              </p>
              <div className="flex gap-6 mt-2">
                <p className="text-sm">Total Regular: <strong>{adpPreviewData.total_regular.toFixed(2)}h</strong></p>
                <p className="text-sm">Total Overtime: <strong>{adpPreviewData.total_overtime.toFixed(2)}h</strong></p>
              </div>
            </div>

            {adpPreviewData.warnings.length > 0 && (
              <div>
                <p className="text-sm font-medium text-yellow-700 mb-2">
                  <AlertTriangle className="inline h-4 w-4 text-yellow-500 mr-1" />
                  Warnings ({adpPreviewData.warnings.length})
                </p>
                <ul className="space-y-1">
                  {adpPreviewData.warnings.map((w, i) => (
                    <li key={i} className="rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left">
                    <th className="py-2 pr-4 font-medium text-gray-700">Employee</th>
                    <th className="py-2 pr-4 font-medium text-gray-700">ADP Code</th>
                    <th className="py-2 pr-4 font-medium text-gray-700">Dept</th>
                    <th className="py-2 pr-4 font-medium text-gray-700 text-right">REG Hrs</th>
                    <th className="py-2 pr-4 font-medium text-gray-700 text-right">OT Hrs</th>
                    <th className="py-2 font-medium text-gray-700 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {adpPreviewData.employees.map((emp, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-2 pr-4">{emp.name}</td>
                      <td className="py-2 pr-4 text-gray-500">{emp.adp_code || '--'}</td>
                      <td className="py-2 pr-4 text-gray-500">{emp.department || '--'}</td>
                      <td className="py-2 pr-4 text-right">{emp.regular_hours.toFixed(2)}</td>
                      <td className="py-2 pr-4 text-right">{emp.overtime_hours > 0 ? emp.overtime_hours.toFixed(2) : '--'}</td>
                      <td className="py-2 text-right font-medium">{emp.total_hours.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAdpModalOpen(false)}>Close</Button>
              <Button
                onClick={async () => {
                  await handleAdpExport();
                  setAdpModalOpen(false);
                }}
                icon={<Download className="h-4 w-4" />}
              >
                Export ADP CSV
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
