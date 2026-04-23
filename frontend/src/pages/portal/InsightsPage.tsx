import { useEffect, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, XCircle,
  DollarSign, Receipt, Store, ChevronRight, ChevronDown,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { insights, type InsightsWindow } from '@/lib/api';

type PresetKey = 'today' | 'yesterday' | '7d' | '28d' | '90d' | 'custom';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '28d', label: 'Last 28 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'custom', label: 'Custom' },
];

// Return YYYY-MM-DD for "today in Pacific time" so browsers in any
// timezone agree with the backend's _pacific_today().
function pacificDate(offsetDays = 0): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const today = fmt.format(new Date()); // 'YYYY-MM-DD'
  if (!offsetDays) return today;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return fmt.format(d);
}

const CHANNEL_COLORS: Record<string, string> = {
  godaddy: '#5CB832',
  tapmango: '#F59E0B',
  doordash: '#EF4444',
};

const CHANNEL_LABEL: Record<string, string> = {
  godaddy: 'In-store',
  tapmango: 'TapMango',
  doordash: 'DoorDash',
};

export function InsightsPage() {
  const [preset, setPreset] = useState<PresetKey>('7d');
  const [customStart, setCustomStart] = useState<string>(() => pacificDate(-6));
  const [customEnd, setCustomEnd] = useState<string>(() => pacificDate(0));
  const [drillDownId, setDrillDownId] = useState<number | null>(null);
  const [inboxCollapsed, setInboxCollapsed] = useState<boolean>(
    () => localStorage.getItem('insights.inboxCollapsed') === '1',
  );

  useEffect(() => {
    localStorage.setItem('insights.inboxCollapsed', inboxCollapsed ? '1' : '0');
  }, [inboxCollapsed]);

  const window = useMemo<InsightsWindow>(() => {
    switch (preset) {
      case 'today': {
        const d = pacificDate(0);
        return { start_date: d, end_date: d };
      }
      case 'yesterday': {
        const d = pacificDate(-1);
        return { start_date: d, end_date: d };
      }
      case '7d':  return { days: 7 };
      case '28d': return { days: 28 };
      case '90d': return { days: 90 };
      case 'custom':
        return { start_date: customStart, end_date: customEnd };
    }
  }, [preset, customStart, customEnd]);

  const windowKey = JSON.stringify(window);

  const { data: pulse, isLoading: pulseLoading } = useQuery({
    queryKey: ['insights-pulse', windowKey],
    queryFn: () => insights.companyPulse(window),
  });

  const { data: scorecardsData, isLoading: scorecardsLoading } = useQuery({
    queryKey: ['insights-scorecards', windowKey],
    queryFn: () => insights.storeScorecards(window),
  });

  const { data: inboxData } = useQuery({
    queryKey: ['insights-inbox'],
    queryFn: insights.actionInbox,
    refetchInterval: 60000,
  });

  const scorecards = scorecardsData?.scorecards ?? [];
  const actions = inboxData?.actions ?? [];

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header + window picker */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Company Insights</h1>
          <p className="text-sm text-gray-500">
            Revenue and trends across all 6 shops
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 flex-wrap">
            {PRESETS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setPreset(opt.key)}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  preset === opt.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex items-center gap-2 text-sm">
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1"
              />
              <span className="text-gray-400">→</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                max={pacificDate(0)}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1"
              />
            </div>
          )}
        </div>
      </div>

      {/* DoorDash freshness banner */}
      {pulse?.doordash_data_through && (
        <div className="flex items-center gap-2 text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          <span>
            DoorDash data current through{' '}
            <strong>
              {new Date(pulse.doordash_data_through + 'T00:00:00').toLocaleDateString()}
            </strong>{' '}
            (updates weekly on Mondays)
          </span>
        </div>
      )}

      {/* Company Pulse */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PulseCard
          label="Gross Revenue"
          value={pulse?.current?.gross}
          delta={pulse?.deltas?.gross_pct}
          icon={<DollarSign className="h-5 w-5" />}
          format="money"
          loading={pulseLoading}
        />
        <PulseCard
          label="Net Revenue"
          value={pulse?.current?.net}
          delta={pulse?.deltas?.net_pct}
          icon={<DollarSign className="h-5 w-5" />}
          format="money"
          loading={pulseLoading}
        />
        <PulseCard
          label="Transactions"
          value={pulse?.current?.transactions}
          delta={pulse?.deltas?.transactions_pct}
          icon={<Receipt className="h-5 w-5" />}
          format="int"
          loading={pulseLoading}
        />
      </div>

      {/* Channel breakdown */}
      {pulse?.current?.by_channel && (
        <Card>
          <h2 className="text-lg font-semibold mb-4">Revenue by channel</h2>
          <ChannelBars byChannel={pulse.current.by_channel} />
        </Card>
      )}

      {/* Action inbox */}
      {actions.length > 0 && (
        <Card>
          <button
            type="button"
            onClick={() => setInboxCollapsed((v) => !v)}
            className="w-full flex items-center gap-2 text-left"
            aria-expanded={!inboxCollapsed}
            aria-controls="action-inbox-body"
          >
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-semibold">Action Inbox</h2>
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
              {actions.length}
            </span>
            <span className="ml-auto text-xs text-gray-400">
              {inboxCollapsed ? 'Show' : 'Hide'}
            </span>
            <ChevronDown
              className={clsx(
                'h-4 w-4 text-gray-400 transition-transform',
                inboxCollapsed && '-rotate-90',
              )}
            />
          </button>
          {!inboxCollapsed && (
            <div id="action-inbox-body" className="divide-y divide-gray-100 mt-4">
              {actions.map((a, i) => (
                <ActionRow key={i} action={a} />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Heatmap */}
      <HeatmapSection scorecards={scorecards} />

      {/* Store scorecards */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Stores</h2>
        {scorecardsLoading ? (
          <LoadingSpinner />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {scorecards.map((s: any) => (
              <StoreCard
                key={s.location_id}
                scorecard={s}
                onClick={() => setDrillDownId(s.location_id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Store drill-down */}
      <StoreDrillDown
        locationId={drillDownId}
        onClose={() => setDrillDownId(null)}
      />
    </div>
  );
}

// -------------------------------------------------------------
// Sub-components
// -------------------------------------------------------------

function PulseCard({
  label, value, delta, icon, format, loading,
}: {
  label: string;
  value: number | undefined;
  delta: number | null | undefined;
  icon: React.ReactNode;
  format: 'money' | 'int';
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card>
        <LoadingSpinner />
      </Card>
    );
  }

  const formatted = format === 'money'
    ? `$${(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : (value ?? 0).toLocaleString();

  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-600">
          {icon}
        </div>
        <div className="flex-1">
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-xl font-bold text-gray-900">{formatted}</p>
        </div>
        {delta != null && (
          <div
            className={clsx(
              'flex items-center gap-1 text-sm font-medium',
              delta >= 0 ? 'text-green-600' : 'text-red-600',
            )}
          >
            {delta >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {delta > 0 ? '+' : ''}{delta}%
          </div>
        )}
      </div>
    </Card>
  );
}

function ChannelBars({ byChannel }: { byChannel: Record<string, any> }) {
  const entries = Object.entries(byChannel);
  const max = Math.max(1, ...entries.map(([, v]: any) => v.gross));

  return (
    <div className="space-y-3">
      {entries.map(([ch, v]: any) => (
        <div key={ch}>
          <div className="flex justify-between text-sm mb-1">
            <span className="font-medium text-gray-700">
              {CHANNEL_LABEL[ch] ?? ch}
            </span>
            <span className="text-gray-500">
              ${v.gross.toLocaleString()} · {v.txns} txns
            </span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(v.gross / max) * 100}%`,
                backgroundColor: CHANNEL_COLORS[ch] ?? '#6B7280',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function StoreCard({
  scorecard,
  onClick,
}: {
  scorecard: any;
  onClick: () => void;
}) {
  const hasData = scorecard.current_gross > 0 || scorecard.current_transactions > 0;

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{scorecard.name}</h3>
          <p className="text-xs text-gray-400 font-mono">
            {scorecard.canonical_short_name}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
      </div>

      {!hasData ? (
        <p className="text-sm text-gray-400 italic">No data yet for this window</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between mb-2">
            <div>
              <p className="text-2xl font-bold text-gray-900">
                ${scorecard.current_gross.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500">
                {scorecard.current_transactions.toLocaleString()} transactions
              </p>
            </div>
            {scorecard.wow_pct != null && (
              <div
                className={clsx(
                  'flex items-center gap-1 text-sm font-medium',
                  scorecard.wow_pct >= 0 ? 'text-green-600' : 'text-red-600',
                )}
              >
                {scorecard.wow_pct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {scorecard.wow_pct > 0 ? '+' : ''}{scorecard.wow_pct}%
              </div>
            )}
          </div>

          <ChannelDots byChannel={scorecard.by_channel} />
        </>
      )}

      <div className="flex items-center gap-1 mt-3 pt-3 border-t border-gray-100">
        <SourceDot connected={scorecard.has_godaddy} label="GoDaddy" color="#5CB832" />
        <SourceDot connected={scorecard.has_tapmango} label="TapMango" color="#F59E0B" />
        <SourceDot connected={scorecard.has_doordash} label="DoorDash" color="#EF4444" />
      </div>
    </Card>
  );
}

function ChannelDots({ byChannel }: { byChannel: Record<string, any> }) {
  const total = Object.values(byChannel).reduce((s: number, v: any) => s + v.gross, 0);
  if (!total) return null;
  return (
    <div className="flex gap-1 h-1.5 rounded-full overflow-hidden bg-gray-100">
      {Object.entries(byChannel).map(([ch, v]: any) => (
        <div
          key={ch}
          style={{
            width: `${(v.gross / total) * 100}%`,
            backgroundColor: CHANNEL_COLORS[ch] ?? '#6B7280',
          }}
        />
      ))}
    </div>
  );
}

function SourceDot({
  connected,
  label,
  color,
}: {
  connected: boolean;
  label: string;
  color: string;
}) {
  return (
    <div
      className="flex items-center gap-1 text-[10px] text-gray-500"
      title={`${label}: ${connected ? 'connected' : 'not set up'}`}
    >
      <span
        className={clsx('h-1.5 w-1.5 rounded-full', !connected && 'opacity-30')}
        style={{ backgroundColor: color }}
      />
      {label}
    </div>
  );
}

function ActionRow({ action }: { action: any }) {
  const Icon =
    action.severity === 'error' ? XCircle :
    action.severity === 'warning' ? AlertTriangle : CheckCircle2;
  const color =
    action.severity === 'error' ? 'text-red-500' :
    action.severity === 'warning' ? 'text-orange-500' : 'text-green-500';

  return (
    <div className="py-3 flex items-start gap-3">
      <Icon className={clsx('h-5 w-5 flex-shrink-0 mt-0.5', color)} />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900">{action.title}</p>
        {action.detail && (
          <p className="text-sm text-gray-500 mt-0.5">{action.detail}</p>
        )}
        {action.occurred_at && (
          <p className="text-xs text-gray-400 mt-0.5">
            {new Date(action.occurred_at + (action.occurred_at.length <= 10 ? 'T00:00:00' : '')).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}

function StoreDrillDown({
  locationId,
  onClose,
}: {
  locationId: number | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['insights-store-daily', locationId],
    queryFn: () => insights.storeDaily(locationId!, 30),
    enabled: !!locationId,
  });

  const series = data?.series ?? [];
  const max = useMemo(
    () => Math.max(1, ...series.map((s: any) => s.gross)),
    [series],
  );

  return (
    <Modal
      open={!!locationId}
      onClose={onClose}
      title="Store details — last 30 days"
      size="lg"
    >
      {isLoading ? (
        <LoadingSpinner />
      ) : series.length === 0 ? (
        <p className="text-sm text-gray-500">No data yet for this store.</p>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <div className="flex items-end gap-1 h-40 min-w-fit">
              {series.map((s: any) => (
                <div
                  key={s.date}
                  className="flex flex-col items-center gap-1"
                  title={`${s.date}: $${s.gross.toLocaleString()} · ${s.transactions} txns`}
                >
                  <div
                    className="w-4 rounded-t transition-all"
                    style={{
                      height: `${(s.gross / max) * 140}px`,
                      backgroundColor: '#5CB832',
                      minHeight: '2px',
                    }}
                  />
                  <span className="text-[9px] text-gray-400 rotate-45 origin-left">
                    {s.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="text-xs text-gray-500 border-t border-gray-100 pt-3">
            Bars show gross revenue per day. Hover for details.
          </div>
        </div>
      )}
    </Modal>
  );
}

// -------------------------------------------------------------
// Heatmap: day-of-week × hour/quarter
// -------------------------------------------------------------

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function HeatmapSection({ scorecards }: { scorecards: any[] }) {
  const [storeId, setStoreId] = useState<number | null>(null);
  const [granularity, setGranularity] = useState<'hour' | 'quarter'>('hour');
  const [metric, setMetric] = useState<'txns' | 'gross'>('txns');
  const [start, setStart] = useState<string>(() => pacificDate(-27));
  const [end, setEnd] = useState<string>(() => pacificDate(-1));

  // Default to the first scorecard once they load
  useEffect(() => {
    if (storeId === null && scorecards.length > 0) {
      setStoreId(scorecards[0].location_id);
    }
  }, [storeId, scorecards]);

  const { data, isLoading } = useQuery({
    queryKey: ['insights-heatmap', storeId, start, end, granularity, metric],
    queryFn: () => insights.heatmap({
      location_id: storeId!,
      start_date: start,
      end_date: end,
      granularity,
      metric,
    }),
    enabled: storeId !== null,
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold">When are we busy?</h2>
        <select
          value={storeId ?? ''}
          onChange={(e) => setStoreId(parseInt(e.target.value, 10))}
          className="border border-gray-300 rounded-md px-2 py-1 text-sm"
        >
          {scorecards.map((s: any) => (
            <option key={s.location_id} value={s.location_id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1 bg-gray-100 rounded-md p-0.5">
          {(['hour', 'quarter'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={clsx(
                'px-2 py-1 rounded text-xs font-medium transition-colors',
                granularity === g ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600',
              )}
            >
              {g === 'hour' ? '1 hr' : '15 min'}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-md p-0.5">
          {(['txns', 'gross'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={clsx(
                'px-2 py-1 rounded text-xs font-medium transition-colors',
                metric === m ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600',
              )}
            >
              {m === 'txns' ? 'Transactions' : 'Revenue $'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto text-xs text-gray-500">
          <input
            type="date"
            value={start}
            max={end}
            onChange={(e) => setStart(e.target.value)}
            className="border border-gray-300 rounded-md px-1.5 py-0.5"
          />
          <span>→</span>
          <input
            type="date"
            value={end}
            min={start}
            max={pacificDate(0)}
            onChange={(e) => setEnd(e.target.value)}
            className="border border-gray-300 rounded-md px-1.5 py-0.5"
          />
        </div>
      </div>

      {isLoading || !data ? (
        <LoadingSpinner />
      ) : data.max_value === 0 ? (
        <p className="text-sm text-gray-500">
          No hourly data in this window. If you've uploaded GoDaddy / TapMango
          files for these dates since the heatmap launched, re-upload them from
          the Analytics Ingestion page to populate hourly buckets.
        </p>
      ) : (
        <HeatmapGrid
          grid={data.grid}
          maxValue={data.max_value}
          granularity={data.granularity}
          metric={data.metric}
        />
      )}
    </Card>
  );
}

function HeatmapGrid({
  grid, maxValue, granularity, metric,
}: {
  grid: number[][];
  maxValue: number;
  granularity: 'hour' | 'quarter';
  metric: 'txns' | 'gross';
}) {
  const slots = granularity === 'hour' ? 24 : 96;
  const cellWidth = granularity === 'hour' ? 28 : 9;
  const cellHeight = 22;

  const fmt = (v: number) => metric === 'gross'
    ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : v.toFixed(1);

  const slotLabel = (s: number) => {
    if (granularity === 'hour') {
      const h = s;
      if (h === 0) return '12a';
      if (h < 12) return `${h}a`;
      if (h === 12) return '12p';
      return `${h - 12}p`;
    } else {
      const h = Math.floor(s / 4);
      const q = (s % 4) * 15;
      if (q !== 0) return '';  // only label on the hour tick
      return h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
    }
  };

  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        {/* Hour labels */}
        <div className="flex pl-10">
          {Array.from({ length: slots }).map((_, s) => (
            <div
              key={s}
              className="text-[10px] text-gray-500 text-center"
              style={{ width: cellWidth }}
            >
              {slotLabel(s)}
            </div>
          ))}
        </div>
        {/* DOW rows */}
        {grid.map((row, dow) => (
          <div key={dow} className="flex items-center">
            <div className="w-10 text-xs text-gray-600 pr-2 text-right">
              {DOW_LABELS[dow]}
            </div>
            {row.map((v, s) => {
              const intensity = maxValue > 0 ? v / maxValue : 0;
              return (
                <div
                  key={s}
                  title={`${DOW_LABELS[dow]} ${slotLabel(s) || `slot ${s}`} · ${fmt(v)}`}
                  style={{
                    width: cellWidth,
                    height: cellHeight,
                    backgroundColor: heatColor(intensity),
                  }}
                  className="border border-white"
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function heatColor(t: number): string {
  // 0 = light gray, 1 = deep green (#5CB832 brand color)
  if (t <= 0) return '#F3F4F6';
  const clamped = Math.max(0, Math.min(1, t));
  // Interpolate toward green from very light to full color.
  const lightR = 240, lightG = 249, lightB = 235;
  const darkR = 45, darkG = 120, darkB = 30;
  const r = Math.round(lightR + (darkR - lightR) * clamped);
  const g = Math.round(lightG + (darkG - lightG) * clamped);
  const b = Math.round(lightB + (darkB - lightB) * clamped);
  return `rgb(${r},${g},${b})`;
}
