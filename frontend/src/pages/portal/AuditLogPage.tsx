import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ClipboardList, ChevronDown, ChevronUp, Download, Filter } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { audit as auditApi, users as usersApi } from '@/lib/api';
import type { AuditLog } from '@/types';

const ACTION_TYPES = [
  { value: '', label: 'All Actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
  { value: 'clock_in', label: 'Clock In' },
  { value: 'clock_out', label: 'Clock Out' },
  { value: 'approve', label: 'Approve' },
  { value: 'deny', label: 'Deny' },
];

const ENTITY_TYPES = [
  { value: '', label: 'All Entities' },
  { value: 'user', label: 'User' },
  { value: 'shift', label: 'Shift' },
  { value: 'time_clock', label: 'Time Clock' },
  { value: 'time_off', label: 'Time Off' },
  { value: 'cash_drawer', label: 'Cash Drawer' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'location', label: 'Location' },
  { value: 'message', label: 'Message' },
];

function ActionBadge({ action }: { action: string }) {
  const variant =
    action === 'create'
      ? 'approved'
      : action === 'delete'
        ? 'denied'
        : action === 'approve'
          ? 'approved'
          : action === 'deny'
            ? 'denied'
            : 'info';
  return <Badge variant={variant}>{action.toUpperCase()}</Badge>;
}

function JsonDiff({ details }: { details: Record<string, unknown> }) {
  const oldValues = details.old as Record<string, unknown> | undefined;
  const newValues = details.new as Record<string, unknown> | undefined;

  if (!oldValues && !newValues) {
    return (
      <pre className="text-xs bg-gray-50 rounded p-2 overflow-auto max-h-48">
        {JSON.stringify(details, null, 2)}
      </pre>
    );
  }

  const allKeys = new Set([
    ...Object.keys(oldValues ?? {}),
    ...Object.keys(newValues ?? {}),
  ]);

  return (
    <div className="space-y-1">
      {Array.from(allKeys).map((key) => {
        const oldVal = oldValues?.[key];
        const newVal = newValues?.[key];
        const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal);
        if (!changed) return null;
        return (
          <div key={key} className="text-xs rounded border border-gray-100 p-2">
            <span className="font-semibold text-gray-600">{key}:</span>
            <div className="ml-4 flex flex-col gap-0.5">
              {oldVal !== undefined && (
                <span className="text-red-600 line-through">
                  {JSON.stringify(oldVal)}
                </span>
              )}
              {newVal !== undefined && (
                <span className="text-green-600">
                  {JSON.stringify(newVal)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [userFilter, setUserFilter] = useState<number>(0);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [showFilters, setShowFilters] = useState(true);

  const { data: usersList } = useQuery({
    queryKey: ['users-for-filter'],
    queryFn: () => usersApi.list({ per_page: 100 }),
  });

  const userOptions = [
    { value: 0, label: 'All Users' },
    ...(usersList?.items ?? []).map((u) => ({
      value: u.id,
      label: `${u.first_name} ${u.last_name}`,
    })),
  ];

  const { data: auditData, isLoading } = useQuery({
    queryKey: ['audit', page, actionFilter, entityFilter, userFilter],
    queryFn: () =>
      auditApi.list({
        page,
        per_page: 25,
        action: actionFilter || undefined,
        resource_type: entityFilter || undefined,
        user_id: userFilter || undefined,
      }),
  });

  const toggleRow = (id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleExport = () => {
    if (!auditData?.items) return;
    const rows = auditData.items.map((log) => ({
      timestamp: format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss'),
      user: log.user ? `${log.user.first_name} ${log.user.last_name}` : `User #${log.user_id}`,
      action: log.action,
      entity_type: log.resource_type,
      entity_id: log.resource_id ?? '',
      ip_address: log.ip_address ?? '',
      details: log.details ? JSON.stringify(log.details) : '',
    }));

    const headers = Object.keys(rows[0] ?? {});
    const csv = [
      headers.join(','),
      ...rows.map((row) =>
        headers.map((h) => `"${String(row[h as keyof typeof row]).replace(/"/g, '""')}"`).join(','),
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_log_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-subtitle">Track all system actions and changes.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilters((s) => !s)}
            icon={<Filter className="h-4 w-4" />}
          >
            Filters
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            disabled={!auditData?.items?.length}
            icon={<Download className="h-4 w-4" />}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Action"
              options={ACTION_TYPES}
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
              className="w-36"
            />
            <Select
              label="Entity Type"
              options={ENTITY_TYPES}
              value={entityFilter}
              onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
              className="w-40"
            />
            <Select
              label="User"
              options={userOptions}
              value={userFilter}
              onChange={(e) => { setUserFilter(Number(e.target.value)); setPage(1); }}
              className="w-48"
            />
            {(actionFilter || entityFilter || userFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setActionFilter('');
                  setEntityFilter('');
                  setUserFilter(0);
                  setPage(1);
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Audit Table */}
      <Card padding={false}>
        {isLoading ? (
          <LoadingSpinner label="Loading audit log..." className="py-12" />
        ) : auditData && auditData.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-10 px-4 py-3" />
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Timestamp
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Entity
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Entity ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    IP Address
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {auditData.items.map((log) => {
                  const isExpanded = expandedRows.has(log.id);
                  return (
                    <>
                      <tr
                        key={log.id}
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => toggleRow(log.id)}
                      >
                        <td className="px-4 py-3">
                          {log.details ? (
                            isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-gray-400" />
                            )
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                          {format(new Date(log.created_at), 'MMM d, yyyy h:mm:ss a')}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {log.user
                            ? `${log.user.first_name} ${log.user.last_name}`
                            : `User #${log.user_id}`}
                        </td>
                        <td className="px-4 py-3">
                          <ActionBadge action={log.action} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {log.resource_type}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {log.resource_id ?? '--'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {log.ip_address ?? '--'}
                        </td>
                      </tr>
                      {isExpanded && log.details && (
                        <tr key={`${log.id}-details`}>
                          <td colSpan={7} className="bg-gray-50 px-8 py-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                              Change Details
                            </p>
                            <JsonDiff details={log.details} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {auditData.total_pages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3">
                <p className="text-sm text-gray-500">
                  Page {auditData.page} of {auditData.total_pages} ({auditData.total} total entries)
                </p>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage((p) => p - 1)}
                    disabled={page <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= auditData.total_pages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<ClipboardList className="h-12 w-12" />}
            title="No Audit Records"
            description="No audit log entries match your current filters."
          />
        )}
      </Card>
    </div>
  );
}
