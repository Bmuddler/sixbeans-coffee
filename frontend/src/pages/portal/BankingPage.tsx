import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  Upload,
  ListChecks,
  ScrollText,
  BookOpen,
  FileText,
  Lock,
  AlertCircle,
  ArrowRight,
  Trash2,
  Sparkles,
  Pencil,
  Check,
  X as XIcon,
  Paperclip,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { finance } from '@/lib/api';

type Tab = 'dashboard' | 'register' | 'upload' | 'rules' | 'categories' | 'ledger' | 'reports' | 'closes';

interface Account {
  id: number;
  name: string;
  short_code: string;
  account_type: string;
  starting_balance: number;
  starting_balance_date: string;
  current_balance: number;
}

interface Category {
  id: number;
  name: string;
  category_type: string;
}

interface Rule {
  id: number;
  rule_name: string;
  match_type: string;
  match_text: string;
  vendor: string | null;
  category_id: number;
  account_id: number | null;
  priority: number;
  is_active: boolean;
}

interface Transaction {
  id: number;
  account_id: number;
  account_name: string;
  account_short_code: string;
  txn_date: string;
  description: string;
  amount: number;
  vendor: string | null;
  category_id: number | null;
  category_name: string | null;
  flow_type: string;
  is_locked: boolean;
  notes: string | null;
  has_receipt: boolean;
}

const money = (v: number | null | undefined): string => {
  if (v == null) return '—';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const startOfMonthISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const startOfYearISO = () => `${new Date().getFullYear()}-01-01`;

function extractError(err: any, fallback: string): string {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    return typeof first === 'string' ? first : (first?.msg ?? fallback);
  }
  return err?.message ?? fallback;
}

export function BankingPage() {
  const [tab, setTab] = useState<Tab>('dashboard');

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <Banknote className="h-4 w-4" /> },
    { key: 'register', label: 'Register', icon: <ListChecks className="h-4 w-4" /> },
    { key: 'upload', label: 'Upload', icon: <Upload className="h-4 w-4" /> },
    { key: 'rules', label: 'Rules', icon: <ScrollText className="h-4 w-4" /> },
    { key: 'categories', label: 'Categories', icon: <BookOpen className="h-4 w-4" /> },
    { key: 'ledger', label: 'Manual Ledger', icon: <BookOpen className="h-4 w-4" /> },
    { key: 'reports', label: 'Reports', icon: <FileText className="h-4 w-4" /> },
    { key: 'closes', label: 'Closes', icon: <Lock className="h-4 w-4" /> },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Banking Center</h1>
          <p className="page-subtitle">Bank feeds, categorization, P&amp;L, and balance sheet — all in one place.</p>
        </div>
      </div>

      <Card className="mb-6 !p-2">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors',
                tab === t.key
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'register' && <RegisterTab />}
      {tab === 'upload' && <UploadTab />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'ledger' && <LedgerTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'closes' && <ClosesTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

type Preset = 'mtd' | 'last30' | 'last90' | 'ytd' | 'custom';

function rangeForPreset(p: Preset, customStart: string, customEnd: string): { start: string; end: string } {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (p === 'mtd') return { start: startOfMonthISO(), end: todayISO() };
  if (p === 'last30') {
    const d = new Date(today); d.setDate(d.getDate() - 29);
    return { start: iso(d), end: todayISO() };
  }
  if (p === 'last90') {
    const d = new Date(today); d.setDate(d.getDate() - 89);
    return { start: iso(d), end: todayISO() };
  }
  if (p === 'ytd') return { start: startOfYearISO(), end: todayISO() };
  return { start: customStart, end: customEnd };
}

function DashboardTab() {
  const { data: accounts } = useQuery<Account[]>({ queryKey: ['finance-accounts'], queryFn: finance.accounts });
  const { data: uncatPage } = useQuery({
    queryKey: ['finance-uncat-count'],
    queryFn: () => finance.transactions({ only_uncategorized: true, per_page: 1 }),
  });

  const [preset, setPreset] = useState<Preset>('mtd');
  const [customStart, setCustomStart] = useState(startOfMonthISO());
  const [customEnd, setCustomEnd] = useState(todayISO());
  const { start, end } = rangeForPreset(preset, customStart, customEnd);

  const { data: pl } = useQuery({
    queryKey: ['finance-pl', 'tax', start, end],
    queryFn: () => finance.pl({ start_date: start, end_date: end, mode: 'tax' }),
  });
  const { data: avg, isLoading: avgLoading, error: avgError } = useQuery({
    queryKey: ['finance-daily-averages', start, end],
    queryFn: () => finance.dailyAverages({ start_date: start, end_date: end }),
  });
  const { data: vendors } = useQuery({
    queryKey: ['finance-top-vendors', start, end],
    queryFn: () => finance.topVendors({ start_date: start, end_date: end, limit: 10 }),
  });

  const accountList = (accounts ?? []).filter((a) => a.account_type !== 'credit_card');
  const ccs = (accounts ?? []).filter((a) => a.account_type === 'credit_card');
  const totalCash = accountList.reduce((s, a) => s + a.current_balance, 0);
  const totalOwed = ccs.reduce((s, a) => s + a.current_balance, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Cash on hand" value={money(totalCash)} hint={`${accountList.length} bank accounts`} />
        <StatCard label="Credit card owed" value={money(totalOwed)} hint={`${ccs.length} cards`} tone={totalOwed > 0 ? 'orange' : undefined} />
        <StatCard label="Net Income (MTD, tax view)" value={money(pl?.totals?.net_income)} hint={`${startOfMonthISO()} → ${todayISO()}`} />
        <StatCard
          label="Uncategorized"
          value={String(uncatPage?.total ?? 0)}
          hint="Click Register tab to fix"
          tone={(uncatPage?.total ?? 0) > 0 ? 'orange' : undefined}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold">Daily averages</h3>
            <p className="text-sm text-gray-500">
              Income vs. actual spend vs. budgeted spend (from your Monthly Expenses page).
            </p>
          </div>
          <div className="flex flex-wrap gap-1 bg-gray-100 rounded p-1">
            {([
              { key: 'mtd', label: 'Month-to-date' },
              { key: 'last30', label: 'Last 30 days' },
              { key: 'last90', label: 'Last 90 days' },
              { key: 'ytd', label: 'Year-to-date' },
              { key: 'custom', label: 'Custom' },
            ] as const).map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key as Preset)}
                className={clsx(
                  'px-3 py-1.5 rounded text-sm transition-colors',
                  preset === p.key ? 'bg-white shadow-sm' : 'text-gray-600',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {preset === 'custom' && (
          <div className="flex gap-2 mb-4">
            <Input label="Start" type="date" value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)} />
            <Input label="End" type="date" value={customEnd} min={customStart} onChange={(e) => setCustomEnd(e.target.value)} />
          </div>
        )}
        {avgError ? (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
            <strong>Couldn't load daily averages:</strong> {extractError(avgError, 'unknown error')}
          </div>
        ) : avgLoading || !avg ? (
          <LoadingSpinner size="sm" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="text-xs uppercase text-green-700">Income / day</p>
              <p className="text-2xl font-bold tabular-nums text-green-700">{money(avg.actual.income_per_day)}</p>
              <p className="text-xs text-gray-600 mt-1">
                {money(avg.actual.income_total)} over {avg.window.days} {avg.window.days === 1 ? 'day' : 'days'}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs uppercase text-gray-700">Actual spend / day</p>
              <p className="text-2xl font-bold tabular-nums text-gray-900">{money(avg.actual.spend_per_day)}</p>
              <p className="text-xs text-gray-600 mt-1">
                {money(avg.actual.spend_total)} actual over the window
              </p>
            </div>
            <div className={clsx(
              'rounded-lg border p-4',
              avg.variance.dollars > 0 ? 'border-orange-200 bg-orange-50' : 'border-blue-200 bg-blue-50',
            )}>
              <p className={clsx('text-xs uppercase', avg.variance.dollars > 0 ? 'text-orange-700' : 'text-blue-700')}>
                Budgeted spend / day
              </p>
              <p className={clsx(
                'text-2xl font-bold tabular-nums',
                avg.variance.dollars > 0 ? 'text-orange-700' : 'text-blue-700',
              )}>
                {money(avg.budget.per_day)}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                {money(avg.budget.monthly_total)} / month from Monthly Expenses
              </p>
            </div>
          </div>
        )}
        {avg && (
          <div className="mt-4 pt-4 border-t flex flex-wrap items-center justify-between gap-2 text-sm">
            <div>
              <span className="text-gray-500">Net per day: </span>
              <strong className={clsx('tabular-nums', avg.actual.net_per_day < 0 && 'text-red-600')}>
                {money(avg.actual.net_per_day)}
              </strong>
            </div>
            <div>
              <span className="text-gray-500">Window total variance vs. budget: </span>
              <strong className={clsx('tabular-nums', avg.variance.dollars > 0 ? 'text-orange-600' : 'text-green-600')}>
                {money(avg.variance.dollars)}
                {avg.variance.pct != null && ` (${avg.variance.pct > 0 ? '+' : ''}${avg.variance.pct}%)`}
              </strong>
            </div>
          </div>
        )}
      </Card>

      <Card title="Account balances">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase text-gray-500 border-b">
              <tr>
                <th className="py-2 text-left">Account</th>
                <th className="py-2 text-left">Type</th>
                <th className="py-2 text-right">Starting balance</th>
                <th className="py-2 text-left">As of</th>
                <th className="py-2 text-right">Current balance</th>
                <th className="py-2 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(accounts ?? []).map((a) => <AccountBalanceRow key={a.id} account={a} />)}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          If a current balance looks wrong: either edit the starting balance (click the pencil), or check that the imported file covers everything from the starting date to today.
        </p>
      </Card>

      <Card title="Top vendors this month (operational view)">
        {!vendors ? (
          <LoadingSpinner size="sm" />
        ) : (vendors.items ?? []).length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No vendor activity yet this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-gray-500 border-b">
                <tr>
                  <th className="py-2 text-left">Vendor</th>
                  <th className="py-2 text-right">Spend MTD</th>
                  <th className="py-2 text-right">Txns</th>
                  <th className="py-2 text-right">vs prior</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {vendors.items.map((v: any) => (
                  <tr key={v.vendor}>
                    <td className="py-2">{v.vendor}</td>
                    <td className="py-2 text-right tabular-nums">{money(v.total)}</td>
                    <td className="py-2 text-right text-gray-500">{v.count}</td>
                    <td className={clsx('py-2 text-right text-xs', v.delta_pct == null ? 'text-gray-400' : v.delta_pct > 0 ? 'text-orange-600' : 'text-green-600')}>
                      {v.delta_pct == null ? '—' : `${v.delta_pct > 0 ? '+' : ''}${v.delta_pct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function AccountBalanceRow({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftBalance, setDraftBalance] = useState(String(account.starting_balance));
  const [draftDate, setDraftDate] = useState(account.starting_balance_date);

  const save = useMutation({
    mutationFn: () =>
      finance.updateAccount(account.id, {
        starting_balance: Number(draftBalance),
        starting_balance_date: draftDate,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['finance-bs'] });
      toast.success('Starting balance updated');
      setEditing(false);
    },
    onError: (err: any) => toast.error(extractError(err, 'Save failed')),
  });

  return (
    <tr>
      <td className="py-2">{account.name}</td>
      <td className="py-2 text-gray-500">{account.account_type}</td>
      <td className="py-2 text-right tabular-nums">
        {editing ? (
          <input
            type="number"
            step="0.01"
            value={draftBalance}
            onChange={(e) => setDraftBalance(e.target.value)}
            className="w-28 border border-gray-200 rounded px-2 py-1 text-right text-sm"
          />
        ) : (
          <span className="text-gray-500">{money(account.starting_balance)}</span>
        )}
      </td>
      <td className="py-2 text-gray-500 text-xs">
        {editing ? (
          <input
            type="date"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1 text-xs"
          />
        ) : (
          account.starting_balance_date
        )}
      </td>
      <td className={clsx(
        'py-2 text-right tabular-nums font-medium',
        account.current_balance < 0 && account.account_type !== 'credit_card' && 'text-red-600',
      )}>
        {money(account.current_balance)}
      </td>
      <td className="py-2 text-right">
        {editing ? (
          <div className="flex justify-end gap-1">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="rounded p-1 text-green-600 hover:bg-green-50"
              title="Save"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setDraftBalance(String(account.starting_balance));
                setDraftDate(account.starting_balance_date);
              }}
              className="rounded p-1 text-gray-500 hover:bg-gray-100"
              title="Cancel"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-primary"
            title="Edit starting balance"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
}

function StatCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'red' | 'orange' }) {
  return (
    <Card>
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className={clsx(
        'text-2xl font-bold tabular-nums mt-1',
        tone === 'red' && 'text-red-600',
        tone === 'orange' && 'text-orange-600',
      )}>
        {value}
      </p>
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

interface DetectedFile {
  filename: string;
  size_bytes: number;
  row_count: number;
  total_inflow: number;
  total_outflow: number;
  suggested_account_id: number | null;
  suggested_account_name: string | null;
  detection_reason: string;
  sample: { date: string; amount: number; description: string }[];
  // Local state
  file: File;
  override_account_id: number | null;
  result?: { inserted: number; skipped_duplicate: number; auto_categorized: number; uncategorized: number; error?: string };
}

function UploadTab() {
  const queryClient = useQueryClient();
  const { data: accounts } = useQuery<Account[]>({ queryKey: ['finance-accounts'], queryFn: finance.accounts });
  const [detected, setDetected] = useState<DetectedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const detectMutation = useMutation({
    mutationFn: (files: File[]) => finance.detect(files),
    onSuccess: (data, files) => {
      const items: DetectedFile[] = (data.files ?? []).map((d: any, i: number) => ({
        ...d,
        file: files[i],
        override_account_id: d.suggested_account_id,
      }));
      setDetected(items);
    },
    onError: (err: any) => toast.error(extractError(err, 'Could not analyze files')),
  });

  const importMutation = useMutation({
    mutationFn: () => {
      const ready = detected.filter((d) => d.override_account_id != null);
      return finance.ingestBatch(ready.map((d) => ({ file: d.file, account_id: d.override_account_id! })));
    },
    onSuccess: (data) => {
      const results = data.results ?? [];
      setDetected((prev) =>
        prev.map((d) => {
          const r = results.find((x: any) => x.filename === d.filename);
          if (!r) return d;
          return { ...d, result: r };
        }),
      );
      queryClient.invalidateQueries({ queryKey: ['finance-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['finance-uncat-count'] });
      queryClient.invalidateQueries({ queryKey: ['finance-pl'] });
      queryClient.invalidateQueries({ queryKey: ['finance-top-vendors'] });
      queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      const totalInserted = results.reduce((s: number, r: any) => s + (r.inserted ?? 0), 0);
      const totalSkipped = results.reduce((s: number, r: any) => s + (r.skipped_duplicate ?? 0), 0);
      const totalUncat = results.reduce((s: number, r: any) => s + (r.uncategorized ?? 0), 0);
      toast.success(`Imported ${totalInserted} new transactions across ${results.length} files. ${totalSkipped} duplicates skipped, ${totalUncat} need categorizing.`);
    },
    onError: (err: any) => toast.error(extractError(err, 'Import failed')),
  });

  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    detectMutation.mutate(arr);
  };

  const accountOptions = useMemo(
    () => [
      { value: '', label: 'Skip this file' },
      ...((accounts ?? []).map((a) => ({ value: String(a.id), label: a.name }))),
    ],
    [accounts],
  );

  return (
    <div className="space-y-4">
      <Card>
        <div
          className={clsx(
            'border-2 border-dashed rounded-lg p-10 text-center transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'border-gray-300',
          )}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-700">
            <strong>Drop all your files here at once</strong>
            <br />
            <span className="text-gray-500">— or —</span>
          </p>
          <label className="inline-block mt-3 px-4 py-2 bg-primary/10 text-primary rounded-lg cursor-pointer hover:bg-primary/20 text-sm font-semibold">
            Pick files
            <input
              type="file"
              multiple
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </label>
          <p className="text-xs text-gray-500 mt-3">
            Wells Fargo Checking / Savings / Cap One transaction CSVs. The system will figure out which file goes where; you can override before importing.
          </p>
          {detectMutation.isPending && <p className="text-sm text-gray-500 mt-3">Analyzing…</p>}
        </div>
      </Card>

      {detected.length > 0 && (
        <Card title={`${detected.length} file${detected.length === 1 ? '' : 's'} ready`}>
          <div className="space-y-3">
            {detected.map((d, idx) => (
              <div key={`${d.filename}-${idx}`} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{d.filename}</p>
                    <p className="text-xs text-gray-500">
                      {d.row_count} rows · {money(d.total_inflow)} in / {money(d.total_outflow)} out
                    </p>
                    {d.sample && d.sample.length > 0 && (
                      <p className="text-xs text-gray-400 mt-1 truncate" title={d.sample.map((s) => s.description).join(' · ')}>
                        First row: {d.sample[0].date} · {money(d.sample[0].amount)} · {d.sample[0].description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <Select
                        options={accountOptions}
                        value={d.override_account_id == null ? '' : String(d.override_account_id)}
                        onChange={(e) => {
                          const v = e.target.value ? Number(e.target.value) : null;
                          setDetected((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, override_account_id: v } : x)),
                          );
                        }}
                        className="min-w-[220px]"
                      />
                      <p className="text-[10px] text-gray-400 mt-0.5">{d.detection_reason}</p>
                    </div>
                    <button
                      onClick={() => setDetected((prev) => prev.filter((_, i) => i !== idx))}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                      title="Remove from batch"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {d.result && (
                  <div className={clsx(
                    'mt-3 rounded p-2 text-xs',
                    d.result.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800',
                  )}>
                    {d.result.error
                      ? `Error: ${d.result.error}`
                      : `Imported ${d.result.inserted} (${d.result.skipped_duplicate} dupes skipped, ${d.result.uncategorized} uncategorized).`}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-gray-500">
              {detected.filter((d) => d.override_account_id != null).length} of {detected.length} ready to import
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDetected([])}>
                Clear
              </Button>
              <Button
                onClick={() => importMutation.mutate()}
                loading={importMutation.isPending}
                disabled={!detected.some((d) => d.override_account_id != null) || detected.every((d) => d.result != null)}
              >
                Import all
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

function RegisterTab() {
  const queryClient = useQueryClient();
  const { data: accounts } = useQuery<Account[]>({ queryKey: ['finance-accounts'], queryFn: finance.accounts });
  const { data: categories } = useQuery<Category[]>({ queryKey: ['finance-categories'], queryFn: () => finance.categories(false) });

  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [onlyUncat, setOnlyUncat] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const params = useMemo(() => {
    const p: any = { page, per_page: 100 };
    if (accountId) p.account_id = Number(accountId);
    if (categoryId) p.category_id = Number(categoryId);
    if (onlyUncat) p.only_uncategorized = true;
    if (search) p.search = search;
    return p;
  }, [page, accountId, categoryId, onlyUncat, search]);

  const { data, isLoading } = useQuery({
    queryKey: ['finance-transactions', params],
    queryFn: () => finance.transactions(params),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => finance.updateTransaction(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['finance-uncat-count'] });
    },
    onError: (err: any) => toast.error(extractError(err, 'Update failed')),
  });

  const recategorize = useMutation({
    mutationFn: () => finance.recategorizeUncategorized(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['finance-uncat-count'] });
      toast.success(`Recategorized ${data.updated} of ${data.examined} uncategorized transactions.`);
    },
    onError: (err: any) => toast.error(extractError(err, 'Recategorize failed')),
  });

  const items: Transaction[] = data?.items ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[180px]">
            <Input
              placeholder="Search description…"
              value={search}
              onChange={(e) => { setPage(1); setSearch(e.target.value); }}
            />
          </div>
          <Select
            className="w-44"
            options={[{ value: '', label: 'All accounts' }, ...((accounts ?? []).map((a) => ({ value: String(a.id), label: a.name })))]}
            value={accountId}
            onChange={(e) => { setPage(1); setAccountId(e.target.value); }}
          />
          <Select
            className="w-48"
            options={[{ value: '', label: 'All categories' }, ...((categories ?? []).map((c) => ({ value: String(c.id), label: c.name })))]}
            value={categoryId}
            onChange={(e) => { setPage(1); setCategoryId(e.target.value); }}
          />
          <Button
            size="sm"
            variant={onlyUncat ? 'secondary' : 'ghost'}
            onClick={() => { setPage(1); setOnlyUncat((v) => !v); }}
          >
            {onlyUncat ? 'Showing uncategorized' : 'Show uncategorized only'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => recategorize.mutate()}
            loading={recategorize.isPending}
          >
            Apply rules to uncategorized
          </Button>
          <Button
            size="sm"
            icon={<Sparkles className="h-4 w-4" />}
            onClick={() => setSuggestOpen(true)}
          >
            Suggest rules
          </Button>
        </div>
      </Card>

      <SuggestRulesModal open={suggestOpen} onClose={() => setSuggestOpen(false)} categories={categories ?? []} />

      <Card title={`Transactions${data?.total != null ? ` · ${data.total}` : ''}`} className="!p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6"><LoadingSpinner size="sm" /></div>
        ) : items.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">No transactions match your filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Account</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-left">Flow</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {items.map((t) => (
                  <TransactionRow
                    key={t.id}
                    txn={t}
                    categories={categories ?? []}
                    onUpdate={(d) => updateMutation.mutate({ id: t.id, data: d })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data?.total != null && data.total > 100 && (
        <div className="flex justify-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            Previous
          </Button>
          <span className="text-sm text-gray-600 self-center">
            Page {page} of {Math.ceil(data.total / 100)}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setPage((p) => p + 1)} disabled={page * 100 >= data.total}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function TransactionRow({
  txn,
  categories,
  onUpdate,
}: {
  txn: Transaction;
  categories: Category[];
  onUpdate: (data: any) => void;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const receiptUpload = useMutation({
    mutationFn: (file: File) => finance.uploadReceipt(txn.id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      toast.success('Receipt attached');
    },
    onError: (err: any) => toast.error(extractError(err, 'Receipt upload failed')),
  });

  return (
    <tr className={clsx(txn.is_locked && 'bg-gray-50')}>
      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{txn.txn_date}</td>
      <td className="px-3 py-2 text-gray-500 text-xs">{txn.account_name.replace('Wells Fargo - ', 'WF ')}</td>
      <td className="px-3 py-2 max-w-md truncate" title={txn.description}>
        <div>{txn.description}</div>
        {txn.vendor && <div className="text-xs text-gray-500">{txn.vendor}</div>}
      </td>
      <td className={clsx('px-3 py-2 text-right tabular-nums', txn.amount < 0 ? 'text-gray-900' : 'text-green-600')}>
        {money(txn.amount)}
      </td>
      <td className="px-3 py-2">
        <select
          className="border border-gray-200 rounded px-2 py-1 text-xs disabled:bg-gray-50"
          value={txn.category_id ?? ''}
          disabled={txn.is_locked}
          onChange={(e) => onUpdate({ category_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 text-xs">
        {txn.flow_type === 'cc_payment' && <Badge variant="pending">CC payment</Badge>}
        {txn.flow_type === 'cc_purchase' && <Badge variant="approved">CC purchase</Badge>}
        {txn.flow_type === 'normal' && <span className="text-gray-400">—</span>}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end items-center gap-1">
          <input
            ref={fileInput}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) receiptUpload.mutate(f);
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            className={clsx(
              'rounded p-1.5 hover:bg-gray-100',
              txn.has_receipt ? 'text-green-600' : 'text-gray-400',
            )}
            title={txn.has_receipt ? 'Replace receipt' : 'Attach receipt'}
            disabled={txn.is_locked}
          >
            <Paperclip className="h-4 w-4" />
          </button>
          {txn.is_locked && <Lock className="h-4 w-4 text-gray-300" />}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function RulesTab() {
  const queryClient = useQueryClient();
  const { data: rules } = useQuery<Rule[]>({ queryKey: ['finance-rules'], queryFn: finance.rules });
  const { data: categories } = useQuery<Category[]>({ queryKey: ['finance-categories'], queryFn: () => finance.categories(false) });
  const { data: accounts } = useQuery<Account[]>({ queryKey: ['finance-accounts'], queryFn: finance.accounts });
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Rule | null>(null);

  const filtered = useMemo(() => {
    if (!search) return rules ?? [];
    const s = search.toLowerCase();
    return (rules ?? []).filter(
      (r) =>
        r.rule_name.toLowerCase().includes(s) ||
        r.match_text.toLowerCase().includes(s) ||
        (r.vendor ?? '').toLowerCase().includes(s),
    );
  }, [rules, search]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => finance.deleteRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-rules'] });
      toast.success('Rule deleted');
    },
    onError: (err: any) => toast.error(extractError(err, 'Delete failed')),
  });

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex gap-3">
          <Input
            placeholder="Search rules…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button onClick={() => setShowAdd(true)}>+ Add Rule</Button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {filtered.length} of {rules?.length ?? 0} rules. Lower priority numbers checked first.
        </p>
      </Card>

      <Card className="!p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Rule</th>
                <th className="px-3 py-2 text-left">Match</th>
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Account scope</th>
                <th className="px-3 py-2 text-right">Pri</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filtered.map((r) => {
                const cat = (categories ?? []).find((c) => c.id === r.category_id);
                const acct = r.account_id == null ? null : (accounts ?? []).find((a) => a.id === r.account_id);
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2 max-w-xs truncate">{r.rule_name}</td>
                    <td className="px-3 py-2 font-mono text-xs"><span className="text-gray-500">{r.match_type}</span> {r.match_text}</td>
                    <td className="px-3 py-2 text-gray-500">{r.vendor || '—'}</td>
                    <td className="px-3 py-2">{cat?.name ?? `#${r.category_id}`}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{acct ? acct.name : 'all'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{r.priority}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setEditing(r)} className="text-xs text-primary hover:underline">Edit</button>
                        <button
                          onClick={() => { if (confirm(`Delete rule "${r.rule_name}"?`)) deleteMutation.mutate(r.id); }}
                          className="rounded p-1 text-gray-400 hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <RuleEditor
        open={showAdd || editing !== null}
        rule={editing}
        categories={categories ?? []}
        onClose={() => { setShowAdd(false); setEditing(null); }}
      />
    </div>
  );
}

function RuleEditor({ open, rule, categories, onClose }: { open: boolean; rule: Rule | null; categories: Category[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: accounts } = useQuery<Account[]>({ queryKey: ['finance-accounts'], queryFn: finance.accounts });
  const [form, setForm] = useState({
    rule_name: '',
    match_type: 'contains' as const,
    match_text: '',
    vendor: '',
    category_id: '',
    account_id: '' as string,  // empty = unscoped (all accounts)
    priority: 100,
    is_active: true,
  });

  useEffect(() => {
    if (rule) {
      setForm({
        rule_name: rule.rule_name,
        match_type: rule.match_type as any,
        match_text: rule.match_text,
        vendor: rule.vendor ?? '',
        category_id: String(rule.category_id),
        account_id: rule.account_id == null ? '' : String(rule.account_id),
        priority: rule.priority,
        is_active: rule.is_active,
      });
    } else if (open) {
      setForm({ rule_name: '', match_type: 'contains', match_text: '', vendor: '', category_id: '', account_id: '', priority: 100, is_active: true });
    }
  }, [rule, open]);

  const save = useMutation({
    mutationFn: () => {
      const data = {
        rule_name: form.rule_name.trim(),
        match_type: form.match_type,
        match_text: form.match_text.trim(),
        vendor: form.vendor.trim() || null,
        category_id: Number(form.category_id),
        account_id: form.account_id ? Number(form.account_id) : null,
        priority: form.priority,
        is_active: form.is_active,
      };
      return rule ? finance.updateRule(rule.id, data) : finance.createRule(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-rules'] });
      toast.success(rule ? 'Rule updated' : 'Rule created');
      onClose();
    },
    onError: (err: any) => toast.error(extractError(err, 'Save failed')),
  });

  return (
    <Modal open={open} onClose={onClose} title={rule ? 'Edit rule' : 'New rule'}>
      <div className="space-y-3">
        <Input label="Rule name" value={form.rule_name} onChange={(e) => setForm({ ...form, rule_name: e.target.value })} />
        <div className="grid grid-cols-3 gap-3">
          <Select
            label="Match type"
            options={[
              { value: 'contains', label: 'contains' },
              { value: 'equals', label: 'equals' },
              { value: 'starts_with', label: 'starts with' },
              { value: 'regex', label: 'regex' },
            ]}
            value={form.match_type}
            onChange={(e) => setForm({ ...form, match_type: e.target.value as any })}
          />
          <Input
            label="Match text"
            value={form.match_text}
            onChange={(e) => setForm({ ...form, match_text: e.target.value })}
            className="col-span-2"
          />
        </div>
        <Input label="Vendor (optional)" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
        <Select
          label="Category"
          options={[{ value: '', label: 'Pick…' }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]}
          value={form.category_id}
          onChange={(e) => setForm({ ...form, category_id: e.target.value })}
        />
        <Select
          label="Account scope (optional)"
          options={[
            { value: '', label: 'All accounts (unscoped)' },
            ...((accounts ?? []).map((a) => ({ value: String(a.id), label: a.name }))),
          ]}
          value={form.account_id}
          onChange={(e) => setForm({ ...form, account_id: e.target.value })}
        />
        <Input
          label="Priority (lower = checked first)"
          type="number"
          value={String(form.priority)}
          onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.match_text || !form.category_id}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function CategoriesTab() {
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: categories } = useQuery<Category[]>({
    queryKey: ['finance-categories', includeArchived],
    queryFn: () => finance.categories(includeArchived),
  });
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => finance.deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-categories'] });
      toast.success('Category deleted');
    },
    onError: (err: any) => toast.error(extractError(err, 'Delete failed')),
  });

  const archiveMutation = useMutation({
    mutationFn: ({ id, isArchived }: { id: number; isArchived: boolean }) =>
      finance.updateCategory(id, { is_archived: isArchived }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-categories'] });
    },
    onError: (err: any) => toast.error(extractError(err, 'Update failed')),
  });

  const grouped = useMemo(() => {
    const order = ['income', 'cogs', 'expense', 'transfer'];
    const g: Record<string, Category[]> = {};
    for (const c of categories ?? []) {
      g[c.category_type] = g[c.category_type] ?? [];
      g[c.category_type].push(c);
    }
    return order
      .filter((k) => g[k] && g[k].length > 0)
      .map((k) => ({ type: k, items: g[k] }));
  }, [categories]);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-semibold">Categories</h3>
            <p className="text-sm text-gray-500">
              The chart of accounts for your books. Income / COGS / Expense / Transfer.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={includeArchived ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setIncludeArchived((v) => !v)}
            >
              {includeArchived ? 'Hide archived' : 'Show archived'}
            </Button>
            <Button onClick={() => setShowAdd(true)}>+ Add Category</Button>
          </div>
        </div>
      </Card>

      {grouped.map(({ type, items }) => (
        <Card key={type} title={type === 'cogs' ? 'COGS' : type.charAt(0).toUpperCase() + type.slice(1)}>
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase text-gray-500 border-b">
              <tr>
                <th className="py-2 text-left">Name</th>
                <th className="py-2 text-right">Sort</th>
                <th className="py-2 text-left">Status</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((c) => (
                <tr key={c.id} className={clsx((c as any).is_archived && 'text-gray-400')}>
                  <td className="py-2">{c.name}</td>
                  <td className="py-2 text-right text-gray-500">{(c as any).sort_order ?? '—'}</td>
                  <td className="py-2 text-xs">
                    {(c as any).is_archived ? (
                      <Badge variant="denied">Archived</Badge>
                    ) : (
                      <Badge variant="approved">Active</Badge>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditing(c)} className="text-xs text-primary hover:underline">Edit</button>
                      <button
                        onClick={() =>
                          archiveMutation.mutate({ id: c.id, isArchived: !(c as any).is_archived })
                        }
                        className="text-xs text-gray-500 hover:underline"
                      >
                        {(c as any).is_archived ? 'Unarchive' : 'Archive'}
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete category "${c.name}"? Refused if any transactions or rules still use it — archive instead.`)) {
                            deleteMutation.mutate(c.id);
                          }
                        }}
                        className="rounded p-1 text-gray-400 hover:text-red-600"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      <CategoryEditor
        open={showAdd || editing !== null}
        category={editing}
        onClose={() => { setShowAdd(false); setEditing(null); }}
      />
    </div>
  );
}

function CategoryEditor({ open, category, onClose }: { open: boolean; category: Category | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    category_type: 'expense' as 'income' | 'cogs' | 'expense' | 'transfer',
  });

  useEffect(() => {
    if (category) {
      setForm({ name: category.name, category_type: category.category_type as any });
    } else if (open) {
      setForm({ name: '', category_type: 'expense' });
    }
  }, [category, open]);

  const save = useMutation({
    mutationFn: () => {
      const data = { name: form.name.trim(), category_type: form.category_type };
      return category ? finance.updateCategory(category.id, data) : finance.createCategory(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-categories'] });
      toast.success(category ? 'Category updated' : 'Category created');
      onClose();
    },
    onError: (err: any) => toast.error(extractError(err, 'Save failed')),
  });

  return (
    <Modal open={open} onClose={onClose} title={category ? 'Edit category' : 'New category'}>
      <div className="space-y-3">
        <Input
          label="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Loan Repayment, Office Supplies"
        />
        <Select
          label="Type"
          options={[
            { value: 'income', label: 'Income — money in (sales, interest, refunds)' },
            { value: 'cogs', label: 'COGS — direct cost of goods (food, supplies)' },
            { value: 'expense', label: 'Expense — operating cost (rent, utilities, etc.)' },
            { value: 'transfer', label: 'Transfer — internal moves, excluded from P&L' },
          ]}
          value={form.category_type}
          onChange={(e) => setForm({ ...form, category_type: e.target.value as any })}
        />
        <p className="text-xs text-gray-500">
          The Type controls where this category appears on the P&L. Transfer-typed categories
          are excluded from both income and expense totals.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.name.trim()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Manual Ledger
// ---------------------------------------------------------------------------

function LedgerTab() {
  const queryClient = useQueryClient();
  const { data: entries } = useQuery<any[]>({ queryKey: ['finance-ledger'], queryFn: finance.ledger });
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => finance.deleteLedgerEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-ledger'] });
      toast.success('Entry deleted');
    },
    onError: (err: any) => toast.error(extractError(err, 'Delete failed')),
  });

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = { asset: [], liability: [], equity: [] };
    for (const e of entries ?? []) {
      g[e.entry_type] = g[e.entry_type] ?? [];
      g[e.entry_type].push(e);
    }
    return g;
  }, [entries]);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex justify-between items-center">
          <div>
            <h3 className="font-semibold">Manual ledger</h3>
            <p className="text-sm text-gray-500">
              Things that don't come from bank feeds: Food Inventory, Furniture & Equipment, Notes Receivable, Member equity / draws.
            </p>
          </div>
          <Button onClick={() => setShowAdd(true)}>+ Add Entry</Button>
        </div>
      </Card>

      {(['asset', 'liability', 'equity'] as const).map((bucket) => (
        <Card key={bucket} title={bucket.charAt(0).toUpperCase() + bucket.slice(1) + 's'}>
          {(grouped[bucket] ?? []).length === 0 ? (
            <p className="text-sm text-gray-500 py-3">None.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-gray-500 border-b">
                <tr>
                  <th className="py-2 text-left">Name</th>
                  <th className="py-2 text-left">Sub-type</th>
                  <th className="py-2 text-left">As of</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {grouped[bucket].map((e) => (
                  <tr key={e.id}>
                    <td className="py-2">{e.name}</td>
                    <td className="py-2 text-gray-500">{e.sub_type ?? '—'}</td>
                    <td className="py-2 text-gray-500">{e.as_of_date}</td>
                    <td className="py-2 text-right tabular-nums">{money(e.amount)}</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setEditing(e)} className="text-xs text-primary hover:underline">Edit</button>
                        <button
                          onClick={() => { if (confirm(`Delete "${e.name}"?`)) deleteMutation.mutate(e.id); }}
                          className="rounded p-1 text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ))}

      <LedgerEditor
        open={showAdd || editing !== null}
        entry={editing}
        onClose={() => { setShowAdd(false); setEditing(null); }}
      />
    </div>
  );
}

function LedgerEditor({ open, entry, onClose }: { open: boolean; entry: any | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    entry_type: 'asset' as 'asset' | 'liability' | 'equity',
    sub_type: '',
    amount: 0,
    as_of_date: todayISO(),
    notes: '',
  });

  useEffect(() => {
    if (entry) {
      setForm({
        name: entry.name,
        entry_type: entry.entry_type,
        sub_type: entry.sub_type ?? '',
        amount: entry.amount,
        as_of_date: entry.as_of_date,
        notes: entry.notes ?? '',
      });
    } else if (open) {
      setForm({ name: '', entry_type: 'asset', sub_type: '', amount: 0, as_of_date: todayISO(), notes: '' });
    }
  }, [entry, open]);

  const save = useMutation({
    mutationFn: () => {
      const data = {
        name: form.name.trim(),
        entry_type: form.entry_type,
        sub_type: form.sub_type.trim() || null,
        amount: form.amount,
        as_of_date: form.as_of_date,
        notes: form.notes.trim() || null,
      };
      return entry ? finance.updateLedgerEntry(entry.id, data) : finance.createLedgerEntry(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-ledger'] });
      toast.success(entry ? 'Entry updated' : 'Entry created');
      onClose();
    },
    onError: (err: any) => toast.error(extractError(err, 'Save failed')),
  });

  return (
    <Modal open={open} onClose={onClose} title={entry ? 'Edit ledger entry' : 'New ledger entry'}>
      <div className="space-y-3">
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Food Inventory, Furniture & Equipment, Member 1 Equity, etc." />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Type"
            options={[
              { value: 'asset', label: 'Asset' },
              { value: 'liability', label: 'Liability' },
              { value: 'equity', label: 'Equity' },
            ]}
            value={form.entry_type}
            onChange={(e) => setForm({ ...form, entry_type: e.target.value as any })}
          />
          <Input label="Sub-type (optional)" value={form.sub_type} onChange={(e) => setForm({ ...form, sub_type: e.target.value })} placeholder="inventory, fixed, notes_receivable, member_equity, member_draws" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Amount" type="number" step="0.01" value={String(form.amount)} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
          <Input label="As of" type="date" value={form.as_of_date} onChange={(e) => setForm({ ...form, as_of_date: e.target.value })} />
        </div>
        <Input label="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.name}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function ReportsTab() {
  const [start, setStart] = useState(startOfYearISO());
  const [end, setEnd] = useState(todayISO());
  const [mode, setMode] = useState<'tax' | 'operational'>('tax');
  const [report, setReport] = useState<'pl' | 'bs' | 'vendors'>('pl');

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex gap-1 bg-gray-100 rounded p-1">
            {(['pl', 'bs', 'vendors'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setReport(r)}
                className={clsx(
                  'px-3 py-1.5 rounded text-sm',
                  report === r ? 'bg-white shadow-sm' : 'text-gray-600',
                )}
              >
                {r === 'pl' ? 'Profit & Loss' : r === 'bs' ? 'Balance Sheet' : 'Top Vendors'}
              </button>
            ))}
          </div>
          {report !== 'bs' && (
            <>
              <Input label="Start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              <Input label="End" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </>
          )}
          {report === 'bs' && (
            <Input label="As of" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          )}
          {report === 'pl' && (
            <div className="flex gap-1 bg-gray-100 rounded p-1">
              {(['tax', 'operational'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={clsx(
                    'px-3 py-1.5 rounded text-sm',
                    mode === m ? 'bg-white shadow-sm' : 'text-gray-600',
                  )}
                >
                  {m === 'tax' ? 'Tax view' : 'Operational view'}
                </button>
              ))}
            </div>
          )}
        </div>
        {report === 'pl' && (
          <p className="text-xs text-gray-500 mt-2">
            <strong>Tax view:</strong> WF transactions only; Cap One purchases excluded; lump CC payment counts as Food Purchases. Matches your accountant's books.
            <br />
            <strong>Operational view:</strong> Cap One purchases counted at vendor level; lump CC payment excluded. Real "where did the money go" picture.
          </p>
        )}
      </Card>

      {report === 'pl' && <PLReport start={start} end={end} mode={mode} />}
      {report === 'bs' && <BalanceSheetReport asOf={end} />}
      {report === 'vendors' && <VendorsReport start={start} end={end} />}
    </div>
  );
}

function PLReport({ start, end, mode }: { start: string; end: string; mode: 'tax' | 'operational' }) {
  const { data, isLoading } = useQuery({
    queryKey: ['finance-pl', mode, start, end],
    queryFn: () => finance.pl({ start_date: start, end_date: end, mode }),
  });
  if (isLoading || !data) return <Card><LoadingSpinner size="sm" /></Card>;
  const Section = ({ title, items }: { title: string; items: any[] }) =>
    items.length === 0 ? null : (
      <div className="mb-4">
        <h4 className="text-sm font-semibold uppercase text-gray-600 mb-2">{title}</h4>
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            {items.map((it) => (
              <tr key={it.category}>
                <td className="py-1.5">{it.category}</td>
                <td className="py-1.5 text-right tabular-nums">{money(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <Card title={`P&L ${data.window.start} → ${data.window.end} · ${mode === 'tax' ? 'Tax view' : 'Operational view'}`}>
      <Section title="Income" items={data.income} />
      <div className="border-t pt-2 mb-3 text-sm flex justify-between">
        <span>Total Income</span><strong className="tabular-nums">{money(data.totals.income)}</strong>
      </div>
      <Section title="Cost of Goods Sold" items={data.cogs} />
      <div className="border-t pt-2 mb-3 text-sm flex justify-between">
        <span>Total COGS</span><strong className="tabular-nums">{money(data.totals.cogs)}</strong>
      </div>
      <div className="border-t pt-2 mb-4 text-sm flex justify-between">
        <span>Gross Profit</span><strong className="tabular-nums">{money(data.totals.gross_profit)}</strong>
      </div>
      <Section title="Expenses" items={data.expense} />
      <div className="border-t pt-2 mb-3 text-sm flex justify-between">
        <span>Total Expenses</span><strong className="tabular-nums">{money(data.totals.expense)}</strong>
      </div>
      <div className="border-t-2 border-gray-300 pt-3 text-base flex justify-between">
        <span className="font-semibold">Net Income</span>
        <strong className={clsx('tabular-nums', data.totals.net_income < 0 && 'text-red-600')}>
          {money(data.totals.net_income)}
        </strong>
      </div>
      {data.diagnostics?.transfer_rows_skipped > 0 && (
        <p className="text-xs text-gray-400 mt-3">
          Skipped {data.diagnostics.transfer_rows_skipped} internal-transfer rows + {data.diagnostics.rows_excluded_by_mode} {mode === 'tax' ? 'CC purchase' : 'CC payment'} rows.
        </p>
      )}
    </Card>
  );
}

function BalanceSheetReport({ asOf }: { asOf: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['finance-bs', asOf],
    queryFn: () => finance.balanceSheet(asOf),
  });
  if (isLoading || !data) return <Card><LoadingSpinner size="sm" /></Card>;
  const Row = ({ name, amount }: { name: string; amount: number }) => (
    <tr><td className="py-1.5">{name}</td><td className="py-1.5 text-right tabular-nums">{money(amount)}</td></tr>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title={`Assets — as of ${data.as_of}`}>
        <h4 className="text-sm font-semibold uppercase text-gray-600 mb-2">Bank accounts</h4>
        <table className="min-w-full text-sm mb-3">
          <tbody className="divide-y divide-gray-100">
            {data.assets.bank.map((b: any) => <Row key={b.id} name={b.name} amount={b.amount} />)}
          </tbody>
        </table>
        {data.assets.other.length > 0 && (
          <>
            <h4 className="text-sm font-semibold uppercase text-gray-600 mb-2">Other assets</h4>
            <table className="min-w-full text-sm mb-3">
              <tbody className="divide-y divide-gray-100">
                {data.assets.other.map((b: any) => <Row key={b.id} name={b.name} amount={b.amount} />)}
              </tbody>
            </table>
          </>
        )}
        <div className="border-t-2 border-gray-300 pt-2 flex justify-between font-semibold">
          <span>Total Assets</span>
          <span className="tabular-nums">{money(data.assets.total)}</span>
        </div>
      </Card>
      <Card title="Liabilities + Equity">
        <h4 className="text-sm font-semibold uppercase text-gray-600 mb-2">Credit cards</h4>
        <table className="min-w-full text-sm mb-3">
          <tbody className="divide-y divide-gray-100">
            {data.liabilities.credit_cards.map((b: any) => <Row key={b.id} name={b.name} amount={b.amount} />)}
          </tbody>
        </table>
        {data.liabilities.other.length > 0 && (
          <>
            <h4 className="text-sm font-semibold uppercase text-gray-600 mb-2">Other liabilities</h4>
            <table className="min-w-full text-sm mb-3">
              <tbody className="divide-y divide-gray-100">
                {data.liabilities.other.map((b: any) => <Row key={b.id} name={b.name} amount={b.amount} />)}
              </tbody>
            </table>
          </>
        )}
        <div className="flex justify-between text-sm border-t pt-2 mb-3">
          <span>Total Liabilities</span>
          <span className="tabular-nums">{money(data.liabilities.total)}</span>
        </div>
        <h4 className="text-sm font-semibold uppercase text-gray-600 mb-2">Equity</h4>
        <table className="min-w-full text-sm mb-3">
          <tbody className="divide-y divide-gray-100">
            {data.equity.manual_items.map((b: any) => <Row key={b.id} name={b.name} amount={b.amount} />)}
            <Row name="Net Income (YTD)" amount={data.equity.ytd_net_income} />
          </tbody>
        </table>
        <div className="flex justify-between text-sm border-t pt-2 mb-2">
          <span>Total Equity</span>
          <span className="tabular-nums">{money(data.equity.total)}</span>
        </div>
        <div className="border-t-2 border-gray-300 pt-2 flex justify-between font-semibold">
          <span>Liab. + Equity</span>
          <span className="tabular-nums">{money(data.totals.liabilities_plus_equity)}</span>
        </div>
        {Math.abs(data.totals.assets - data.totals.liabilities_plus_equity) > 0.5 && (
          <p className="text-xs text-orange-600 mt-2 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> Books don't balance — diff {money(data.totals.assets - data.totals.liabilities_plus_equity)}. Adjust starting balances or add equity entries.
          </p>
        )}
      </Card>
    </div>
  );
}

function VendorsReport({ start, end }: { start: string; end: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['finance-top-vendors', 'report', start, end],
    queryFn: () => finance.topVendors({ start_date: start, end_date: end, limit: 50 }),
  });
  if (isLoading || !data) return <Card><LoadingSpinner size="sm" /></Card>;
  return (
    <Card title={`Top vendors ${data.window.start} → ${data.window.end}`}>
      {(data.items ?? []).length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">No vendor activity in this window.</p>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="text-xs uppercase text-gray-500 border-b">
            <tr>
              <th className="py-2 text-left">#</th>
              <th className="py-2 text-left">Vendor</th>
              <th className="py-2 text-right">Spend</th>
              <th className="py-2 text-right">Txns</th>
              <th className="py-2 text-right">Prior period</th>
              <th className="py-2 text-right">Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.items.map((v: any, i: number) => (
              <tr key={v.vendor}>
                <td className="py-2 text-gray-400 text-xs">{i + 1}</td>
                <td className="py-2">{v.vendor}</td>
                <td className="py-2 text-right tabular-nums">{money(v.total)}</td>
                <td className="py-2 text-right text-gray-500">{v.count}</td>
                <td className="py-2 text-right text-gray-500 tabular-nums">{money(v.prior_total)}</td>
                <td className={clsx('py-2 text-right text-xs tabular-nums', v.delta_pct == null ? 'text-gray-400' : v.delta_pct > 0 ? 'text-orange-600' : 'text-green-600')}>
                  {v.delta_pct == null ? '—' : `${v.delta_pct > 0 ? '+' : ''}${v.delta_pct}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Closes
// ---------------------------------------------------------------------------

function ClosesTab() {
  const queryClient = useQueryClient();
  const { data: closes } = useQuery<any[]>({ queryKey: ['finance-closes'], queryFn: finance.closes });
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [notes, setNotes] = useState('');

  const closeM = useMutation({
    mutationFn: () => finance.closeMonth({ year, month, notes: notes || undefined }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['finance-closes'] });
      queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      toast.success(`Closed ${year}-${String(month).padStart(2, '0')} — locked ${data.transactions_locked} transactions.`);
      setNotes('');
    },
    onError: (err: any) => toast.error(extractError(err, 'Close failed')),
  });

  const reopen = useMutation({
    mutationFn: ({ y, m }: { y: number; m: number }) => finance.reopenMonth(y, m),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-closes'] });
      queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      toast.success('Month reopened');
    },
    onError: (err: any) => toast.error(extractError(err, 'Reopen failed')),
  });

  return (
    <div className="space-y-4">
      <Card title="Close a month">
        <p className="text-sm text-gray-500 mb-3">
          Locking a month freezes its transactions so they can't be edited accidentally. The system refuses to close a month if any transactions are still uncategorized.
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <Input label="Year" type="number" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} />
          <Select
            label="Month"
            options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: new Date(2000, i, 1).toLocaleString('default', { month: 'long' }) }))}
            value={String(month)}
            onChange={(e) => setMonth(Number(e.target.value))}
          />
          <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button onClick={() => closeM.mutate()} loading={closeM.isPending} icon={<ArrowRight className="h-4 w-4" />}>
            Close month
          </Button>
        </div>
      </Card>

      <Card title="Closed months">
        {(closes ?? []).length === 0 ? (
          <p className="text-sm text-gray-500 py-3">No months closed yet.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase text-gray-500 border-b">
              <tr>
                <th className="py-2 text-left">Period</th>
                <th className="py-2 text-left">Closed</th>
                <th className="py-2 text-left">Notes</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(closes ?? []).map((c: any) => (
                <tr key={`${c.year}-${c.month}`}>
                  <td className="py-2">{c.year}-{String(c.month).padStart(2, '0')}</td>
                  <td className="py-2 text-gray-500">{new Date(c.closed_at).toLocaleDateString()}</td>
                  <td className="py-2 text-gray-500">{c.notes || '—'}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => { if (confirm(`Reopen ${c.year}-${String(c.month).padStart(2, '0')}? This unlocks all its transactions.`)) reopen.mutate({ y: c.year, m: c.month }); }}
                      className="text-xs text-primary hover:underline"
                    >
                      Reopen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggest Rules modal
// ---------------------------------------------------------------------------

interface Proposal {
  merchant: string;
  category_name: string;
  category_id: number | null;
  vendor: string | null;
  sample_descriptions: string[];
  match_count: number;
  source: 'heuristic' | 'llm' | 'fallback';
  confidence: number;
  approved: boolean;
  override_category_id?: number | null;
}

function SuggestRulesModal({
  open,
  onClose,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  categories: Category[];
}) {
  const queryClient = useQueryClient();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [stats, setStats] = useState<{ total_uncategorized: number; unique_merchants: number } | null>(null);

  const suggest = useMutation({
    mutationFn: () => finance.suggestRules(true),
    onSuccess: (data) => {
      setStats({ total_uncategorized: data.total_uncategorized, unique_merchants: data.unique_merchants });
      const items: Proposal[] = (data.proposals ?? []).map((p: any) => ({
        ...p,
        approved: p.source !== 'fallback' && p.confidence >= 0.6,
        override_category_id: p.category_id,
      }));
      setProposals(items);
    },
    onError: (err: any) => toast.error(extractError(err, 'Suggest failed')),
  });

  const apply = useMutation({
    mutationFn: () => {
      const accepted = proposals
        .filter((p) => p.approved && p.override_category_id != null)
        .map((p) => ({
          merchant: p.merchant,
          category_id: p.override_category_id!,
          vendor: p.vendor,
          create_rule: true,
        }));
      return finance.acceptRules(accepted);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['finance-rules'] });
      queryClient.invalidateQueries({ queryKey: ['finance-uncat-count'] });
      toast.success(`Created ${data.rules_created} rules and recategorized ${data.transactions_updated} transactions.`);
      onClose();
      setProposals([]);
      setStats(null);
    },
    onError: (err: any) => toast.error(extractError(err, 'Apply failed')),
  });

  useEffect(() => {
    if (open && proposals.length === 0 && !suggest.isPending) {
      suggest.mutate();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const approvedCount = proposals.filter((p) => p.approved && p.override_category_id != null).length;

  return (
    <Modal open={open} onClose={onClose} title="Suggested rules">
      <div className="space-y-3">
        {suggest.isPending ? (
          <div className="py-12 text-center">
            <Sparkles className="h-8 w-8 text-primary mx-auto mb-2 animate-pulse" />
            <p className="text-sm text-gray-600">Analyzing uncategorized transactions…</p>
            <p className="text-xs text-gray-500 mt-1">Calls Claude for any unfamiliar merchants.</p>
          </div>
        ) : proposals.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">No uncategorized transactions to suggest rules for.</p>
        ) : (
          <>
            {stats && (
              <p className="text-sm text-gray-600">
                {stats.unique_merchants} unique merchants across {stats.total_uncategorized} uncategorized transactions.
                Tick the rows you trust and click Apply — each creates a rule and recategorizes every matching row.
              </p>
            )}

            <div className="max-h-[480px] overflow-y-auto -mx-6 px-6">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-white text-xs uppercase text-gray-500 border-b">
                  <tr>
                    <th className="py-2 pr-2 text-left w-6"></th>
                    <th className="py-2 pr-2 text-left">Match (merchant)</th>
                    <th className="py-2 pr-2 text-left">Category</th>
                    <th className="py-2 pr-2 text-right"># txns</th>
                    <th className="py-2 pr-2 text-left">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {proposals.map((p, i) => (
                    <tr key={p.merchant} className={clsx(p.source === 'fallback' && 'bg-gray-50')}>
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          checked={p.approved}
                          disabled={p.override_category_id == null}
                          onChange={(e) =>
                            setProposals((prev) =>
                              prev.map((x, idx) => (idx === i ? { ...x, approved: e.target.checked } : x)),
                            )
                          }
                        />
                      </td>
                      <td className="py-2 pr-2 align-top">
                        <div className="font-mono text-xs">{p.merchant}</div>
                        {p.sample_descriptions.length > 0 && (
                          <div className="text-[11px] text-gray-400 mt-0.5 truncate max-w-md" title={p.sample_descriptions.join(' · ')}>
                            e.g. {p.sample_descriptions[0].slice(0, 60)}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          className="border border-gray-200 rounded px-2 py-1 text-xs"
                          value={p.override_category_id ?? ''}
                          onChange={(e) => {
                            const v = e.target.value ? Number(e.target.value) : null;
                            setProposals((prev) =>
                              prev.map((x, idx) =>
                                idx === i ? { ...x, override_category_id: v, approved: v != null && x.approved } : x,
                              ),
                            );
                          }}
                        >
                          <option value="">— pick —</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{p.match_count}</td>
                      <td className="py-2 pr-2 text-xs">
                        {p.source === 'heuristic' && <Badge variant="approved">vendor map</Badge>}
                        {p.source === 'llm' && (
                          <Badge variant="pending">Claude · {Math.round(p.confidence * 100)}%</Badge>
                        )}
                        {p.source === 'fallback' && <Badge variant="denied">unknown</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center pt-3 border-t">
              <p className="text-sm text-gray-600">{approvedCount} of {proposals.length} ready to apply</p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button onClick={() => apply.mutate()} loading={apply.isPending} disabled={approvedCount === 0}>
                  Apply {approvedCount}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
