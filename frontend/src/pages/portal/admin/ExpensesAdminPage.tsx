import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { Plus, Trash2, Upload, DollarSign, Check, X, Lock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  expensesApi,
  type ExpenseLocation,
  type ExpenseRow,
} from '@/lib/api';

const DAYS_PER_MONTH = 30.44;

export function ExpensesAdminPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['expenses-list'],
    queryFn: expensesApi.list,
  });
  const { data: settings } = useQuery({
    queryKey: ['expenses-settings'],
    queryFn: expensesApi.getSettings,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['expenses-list'] });

  const createMutation = useMutation({
    mutationFn: expensesApi.create,
    onSuccess: () => invalidate(),
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? 'Failed to create'),
  });

  const updateMutation = useMutation({
    mutationFn: (args: { id: number; body: Partial<{ category: string; amount: number; notes: string | null }> }) =>
      expensesApi.update(args.id, args.body),
    onSuccess: () => invalidate(),
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? 'Failed to update'),
  });

  const deleteMutation = useMutation({
    mutationFn: expensesApi.remove,
    onSuccess: () => invalidate(),
    onError: () => toast.error('Failed to delete'),
  });

  const settingsMutation = useMutation({
    mutationFn: expensesApi.updateSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses-settings'] });
      toast.success('Settings saved');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? 'Failed to save'),
  });

  const seedMutation = useMutation({
    mutationFn: ({ file, replace }: { file: File; replace: boolean }) =>
      expensesApi.seedFromPnl(file, replace),
    onSuccess: (res: any) => {
      toast.success(`Imported ${res.created} expenses (${res.skipped_duplicates} duplicates skipped)`);
      invalidate();
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? 'Seed failed'),
  });

  const seedInputRef = useRef<HTMLInputElement | null>(null);

  // Group expenses by location
  const grouped = useMemo(() => {
    if (!data) return null;
    const byLocation = new Map<number | null, ExpenseRow[]>();
    byLocation.set(null, []);
    for (const loc of data.locations) byLocation.set(loc.id, []);
    for (const e of data.expenses) {
      if (!byLocation.has(e.location_id)) byLocation.set(e.location_id, []);
      byLocation.get(e.location_id)!.push(e);
    }
    return byLocation;
  }, [data]);

  const cardOrder = useMemo(() => {
    if (!data) return [];
    // Preferred ordering: 6 shops alphabetical, then BAKERY, WAREHOUSE, then COMPANY
    const preferred = [
      'APPLE_VALLEY_HS', 'BARSTOW', 'HESPERIA',
      'SEVENTH_STREET', 'VICTORVILLE', 'YUCCA_LOMA',
      'BAKERY', 'WAREHOUSE',
    ];
    const out: Array<ExpenseLocation | null> = [];
    for (const short of preferred) {
      const loc = data.locations.find((l) => l.canonical_short_name === short);
      if (loc) out.push(loc);
    }
    // Any other non-canonical locations
    for (const loc of data.locations) {
      if (!preferred.includes(loc.canonical_short_name) && !out.includes(loc)) out.push(loc);
    }
    out.push(null); // Company overhead last
    return out;
  }, [data]);

  if (isLoading || !grouped) {
    return (
      <div className="p-6">
        <LoadingSpinner />
      </div>
    );
  }

  const totalAll = data!.expenses.reduce((s, e) => s + e.amount, 0);
  const canEdit = !!data?.can_edit;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Monthly Expenses</h1>
          <p className="text-sm text-gray-500">
            One current snapshot per location. Payroll is excluded — it comes from Homebase
            inflated by the labor burden multiplier.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-gray-500">Monthly total</p>
            <p className="text-xl font-bold text-gray-900">
              ${totalAll.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-gray-400">
              ~${(totalAll / DAYS_PER_MONTH).toFixed(0)}/day
            </p>
          </div>
        </div>
      </div>

      {!canEdit && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            Expenses are locked. Viewing only — the primary owner is the only
            account that can edit these figures, the labor burden, or the COGS %.
          </span>
        </div>
      )}

      {/* Settings row */}
      <Card>
        <div className="flex flex-wrap items-end gap-6">
          <SettingsField
            label="Labor burden multiplier"
            help="Homebase wages × this = fully-loaded labor (taxes, benefits, WC)"
            value={settings?.labor_burden_multiplier ?? 1.25}
            step={0.01}
            min={1}
            max={2}
            readOnly={!canEdit}
            onCommit={(v) => settingsMutation.mutate({ labor_burden_multiplier: v })}
            format={(v) => `${v.toFixed(2)}x`}
          />
          <SettingsField
            label="COGS %"
            help="Cost of goods as share of revenue"
            value={settings?.cogs_percent ?? 0.22}
            step={0.005}
            min={0}
            max={1}
            readOnly={!canEdit}
            onCommit={(v) => settingsMutation.mutate({ cogs_percent: v })}
            format={(v) => `${(v * 100).toFixed(1)}%`}
          />
          <div className="ml-auto">
            <Button
              size="sm"
              variant="secondary"
              icon={<Upload className="h-4 w-4" />}
              onClick={() => seedInputRef.current?.click()}
              loading={seedMutation.isPending}
              disabled={!canEdit}
            >
              Import from P&L Excel
            </Button>
            <input
              ref={seedInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const replace = confirm(
                    'Replace ALL existing expense rows with the contents of this Excel file?\n\n' +
                    'OK = replace everything\nCancel = only add rows that don\'t already exist',
                  );
                  seedMutation.mutate({ file: f, replace });
                }
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </Card>

      {/* Location cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {cardOrder.map((loc) => {
          const id = loc?.id ?? null;
          const rows = grouped.get(id) ?? [];
          return (
            <ExpenseCard
              key={id ?? 'company'}
              location={loc}
              rows={rows}
              canEdit={canEdit}
              onCreate={(body) => createMutation.mutate({ ...body, location_id: id })}
              onUpdate={(eid, body) => updateMutation.mutate({ id: eid, body })}
              onDelete={(eid) => deleteMutation.mutate(eid)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Single location card
// ------------------------------------------------------------

function ExpenseCard({
  location,
  rows,
  canEdit,
  onCreate,
  onUpdate,
  onDelete,
}: {
  location: ExpenseLocation | null;
  rows: ExpenseRow[];
  canEdit: boolean;
  onCreate: (body: { category: string; amount: number }) => void;
  onUpdate: (id: number, body: Partial<{ category: string; amount: number }>) => void;
  onDelete: (id: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newAmount, setNewAmount] = useState('');

  const title = location
    ? `${location.name}`
    : 'Company overhead / shared COGS';

  const total = rows.reduce((s, r) => s + r.amount, 0);

  const handleAdd = () => {
    const cat = newCategory.trim();
    const amt = parseFloat(newAmount);
    if (!cat || !isFinite(amt)) {
      toast.error('Category + numeric amount required');
      return;
    }
    onCreate({ category: cat, amount: amt });
    setNewCategory('');
    setNewAmount('');
    setAdding(false);
  };

  return (
    <Card>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-gray-900 truncate">{title}</h2>
          {location && (
            <p className="text-xs text-gray-400 font-mono">
              {location.canonical_short_name}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-gray-900">
            ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[10px] text-gray-400">
            ~${(total / DAYS_PER_MONTH).toFixed(2)}/day
          </p>
        </div>
      </div>

      <div className="divide-y divide-gray-100 -mx-2">
        {rows.length === 0 && !adding && (
          <p className="px-2 py-4 text-sm text-gray-400 italic">No expenses yet.</p>
        )}
        {rows.map((r) => (
          <ExpenseRowEditor
            key={r.id}
            row={r}
            canEdit={canEdit}
            onUpdate={(body) => onUpdate(r.id, body)}
            onDelete={() => onDelete(r.id)}
          />
        ))}
      </div>

      {adding ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Category"
            className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
          />
          <input
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            placeholder="0.00"
            type="number"
            step="0.01"
            className="w-24 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
          />
          <button
            onClick={handleAdd}
            className="p-1 text-green-600 hover:bg-green-50 rounded"
            aria-label="Save"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setAdding(false); setNewCategory(''); setNewAmount(''); }}
            className="p-1 text-gray-500 hover:bg-gray-100 rounded"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : canEdit ? (
        <button
          onClick={() => setAdding(true)}
          className="mt-2 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
        >
          <Plus className="h-3.5 w-3.5" /> Add expense
        </button>
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------
// One row — inline editable
// ------------------------------------------------------------

function ExpenseRowEditor({
  row,
  canEdit,
  onUpdate,
  onDelete,
}: {
  row: ExpenseRow;
  canEdit: boolean;
  onUpdate: (body: Partial<{ category: string; amount: number }>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState(row.category);
  const [amount, setAmount] = useState(row.amount.toString());

  const commit = () => {
    const cat = category.trim();
    const amt = parseFloat(amount);
    const changed: any = {};
    if (cat && cat !== row.category) changed.category = cat;
    if (isFinite(amt) && amt !== row.amount) changed.amount = amt;
    if (Object.keys(changed).length) onUpdate(changed);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="px-2 py-1.5 flex items-center gap-2">
        <input
          autoFocus
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm"
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          step="0.01"
          className="w-24 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        />
        <button onClick={commit} className="p-1 text-green-600 hover:bg-green-50 rounded">
          <Check className="h-4 w-4" />
        </button>
        <button onClick={() => setEditing(false)} className="p-1 text-gray-500 hover:bg-gray-100 rounded">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="px-2 py-1.5 flex items-center gap-2">
        <span className="flex-1 min-w-0 text-sm text-gray-700 truncate">{row.category}</span>
        <span className="text-sm text-gray-600 tabular-nums">
          ${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
    );
  }

  return (
    <div className="px-2 py-1.5 flex items-center gap-2 group">
      <button
        onClick={() => setEditing(true)}
        className="flex-1 min-w-0 text-left text-sm text-gray-700 hover:text-gray-900 truncate"
      >
        {row.category}
      </button>
      <button
        onClick={() => setEditing(true)}
        className="text-sm text-gray-600 tabular-nums hover:text-gray-900"
      >
        ${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </button>
      <button
        onClick={() => {
          if (confirm(`Delete "${row.category}"?`)) onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-50 rounded transition-opacity"
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ------------------------------------------------------------
// Settings number field with debounced commit
// ------------------------------------------------------------

function SettingsField({
  label, help, value, step, min, max, onCommit, format, readOnly,
}: {
  label: string;
  help: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
  format: (v: number) => string;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(value.toString());
  const [focused, setFocused] = useState(false);

  // Keep draft in sync when the upstream value changes (e.g. after save)
  // but only when not being actively edited.
  const displayed = focused ? draft : value.toString();

  return (
    <label className="flex flex-col">
      <span className="text-xs text-gray-500 mb-1">
        {label}{' '}
        <span className="text-gray-400 font-normal">· {format(value)}</span>
      </span>
      <input
        type="number"
        value={displayed}
        step={step}
        min={min}
        max={max}
        readOnly={readOnly}
        disabled={readOnly}
        onFocus={() => { if (!readOnly) { setFocused(true); setDraft(value.toString()); } }}
        onBlur={() => {
          setFocused(false);
          const v = parseFloat(draft);
          if (isFinite(v) && v !== value) onCommit(v);
        }}
        onChange={(e) => setDraft(e.target.value)}
        className={`w-28 border border-gray-300 rounded-md px-2 py-1 text-sm ${readOnly ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
      />
      <span className="text-[10px] text-gray-400 mt-0.5">{help}</span>
    </label>
  );
}
