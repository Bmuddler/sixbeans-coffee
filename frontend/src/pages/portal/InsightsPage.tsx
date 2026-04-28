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

      {/* Data freshness — shows which sources have gaps in the selected window */}
      <DataFreshnessBanner window={window} />

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
          value={pulse?.current?.net_after_card_fee ?? pulse?.current?.net}
          delta={pulse?.deltas?.net_pct}
          icon={<DollarSign className="h-5 w-5" />}
          format="money"
          loading={pulseLoading}
          subline={
            pulse?.current?.estimated_card_processing_fee
              ? `after ~$${Math.round(pulse.current.estimated_card_processing_fee).toLocaleString()} card fee (${((pulse.current.card_processing_fee_pct ?? 0.023) * 100).toFixed(1)}%)`
              : undefined
          }
        />
        <PulseCard
          label="Transactions"
          value={pulse?.current?.transactions}
          delta={pulse?.deltas?.transactions_pct}
          icon={<Receipt className="h-5 w-5" />}
          format="int"
          loading={pulseLoading}
        />
        <CompanyProfitCard window={window} />
      </div>

      {/* Elite scorecards */}
      <EliteSection window={window} />

      {/* Channel breakdown */}
      {pulse?.current?.by_channel && (
        <Card>
          <h2 className="text-lg font-semibold mb-4">Revenue by channel</h2>
          <ChannelBars byChannel={pulse.current.by_channel} />
        </Card>
      )}

      {/* Channel Fees: silent costs taken before deposits hit the bank */}
      {pulse?.current && (pulse.current.total_silent_fees > 0 || (pulse.current.card_total ?? 0) > 0) && (
        <Card>
          <h2 className="text-lg font-semibold mb-1">Channel Fees</h2>
          <p className="text-xs text-gray-500 mb-4">
            Silent costs taken out before money lands in the bank. None of these appear as line items on your bank statement, but they reduce your real net revenue.
          </p>
          <ChannelFeesCard pulse={pulse.current} />
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
  label, value, delta, icon, format, loading, subline,
}: {
  label: string;
  value: number | undefined;
  delta: number | null | undefined;
  icon: React.ReactNode;
  format: 'money' | 'int';
  loading: boolean;
  subline?: string;
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
          {subline && <p className="text-[11px] text-gray-500 mt-0.5">{subline}</p>}
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

function CompanyProfitCard({ window }: { window: InsightsWindow }) {
  const { data, isLoading } = useQuery({
    queryKey: ['insights-elite', JSON.stringify(window)],
    queryFn: () => insights.eliteScorecards(window),
  });

  if (isLoading) {
    return (
      <Card>
        <LoadingSpinner />
      </Card>
    );
  }

  const profit = data?.company?.profit ?? null;
  const margin = data?.company?.margin_pct ?? null;
  const opp = data?.company?.labor_opportunity ?? 0;
  const tone = profit != null && profit < 0 ? 'red' : undefined;
  const formatted = profit == null
    ? 'n/a'
    : `$${profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const marginText = margin == null ? '—' : `${margin.toFixed(1)}% margin`;

  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className={clsx(
          'h-10 w-10 rounded-lg flex items-center justify-center',
          tone === 'red' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600',
        )}>
          <TrendingUp className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-gray-500">True Profit</p>
          <p className={clsx(
            'text-xl font-bold tabular-nums',
            tone === 'red' ? 'text-red-600' : 'text-gray-900',
          )}>
            {formatted}
          </p>
          <p className="text-xs text-gray-500">
            {marginText}
            {opp > 0 ? ` · $${Math.round(opp).toLocaleString('en-US')} labor opp.` : ''}
          </p>
        </div>
      </div>
    </Card>
  );
}

function Sparkline({ values, height = 32 }: { values: number[]; height?: number }) {
  if (!values || values.length === 0) return null;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const width = 120;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const yFor = (v: number) => height - ((v - min) / range) * height;
  const points = values.map((v, i) => `${(i * step).toFixed(2)},${yFor(v).toFixed(2)}`).join(' ');
  const lastVal = values[values.length - 1];
  const lastX = (values.length - 1) * step;
  const lastY = yFor(lastVal);
  const lastPositive = lastVal >= 0;
  const stroke = lastPositive ? '#059669' : '#dc2626';
  const baseY = yFor(0);
  const trend = values.length > 1 ? values[values.length - 1] - values[0] : 0;

  return (
    <div className="flex items-center gap-2">
      <svg width={width} height={height} className="overflow-visible">
        {/* zero line */}
        {min < 0 && max > 0 && (
          <line x1={0} y1={baseY} x2={width} y2={baseY} stroke="#e5e7eb" strokeDasharray="2,2" />
        )}
        <polyline
          points={points}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={lastX} cy={lastY} r={2} fill={stroke} />
      </svg>
      <span
        className={clsx(
          'text-[10px] font-medium tabular-nums',
          trend >= 0 ? 'text-green-600' : 'text-red-600',
        )}
        title="28-day trend (most recent vs. earliest day)"
      >
        {trend >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(trend)).toLocaleString('en-US')}
      </span>
    </div>
  );
}

function ChannelFeesCard({ pulse }: { pulse: any }) {
  const card = pulse.card_total ?? 0;
  const cash = pulse.cash_total ?? 0;
  const cardFee = pulse.estimated_card_processing_fee ?? 0;
  const cardFeePct = (pulse.card_processing_fee_pct ?? 0.023) * 100;
  const ddCommission = pulse.by_channel?.doordash?.commission ?? 0;
  const ddFees = pulse.by_channel?.doordash?.fees ?? 0;
  const ddGross = pulse.by_channel?.doordash?.gross ?? 0;
  const ddTotalFees = ddCommission + ddFees;
  const ddPct = ddGross > 0 ? (ddTotalFees / ddGross) * 100 : 0;
  const totalSilent = pulse.total_silent_fees ?? cardFee + ddTotalFees;

  const money = (v: number) =>
    `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const total = card + cash;
  const cardPct = total > 0 ? (card / total) * 100 : 0;
  const cashPct = total > 0 ? (cash / total) * 100 : 0;

  return (
    <div className="space-y-5">
      {(card > 0 || cash > 0) && (
        <div>
          <p className="text-xs uppercase text-gray-500 mb-2">GoDaddy: Cash vs Card</p>
          <div className="flex h-7 w-full overflow-hidden rounded-md border border-gray-200 mb-2">
            {card > 0 && (
              <div className="bg-blue-500 text-white text-xs flex items-center justify-center" style={{ width: `${cardPct}%` }}>
                {cardPct >= 10 ? `Card ${cardPct.toFixed(0)}%` : ''}
              </div>
            )}
            {cash > 0 && (
              <div className="bg-emerald-500 text-white text-xs flex items-center justify-center" style={{ width: `${cashPct}%` }}>
                {cashPct >= 10 ? `Cash ${cashPct.toFixed(0)}%` : ''}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">Card</p>
              <p className="font-semibold tabular-nums">{money(card)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Cash</p>
              <p className="font-semibold tabular-nums">{money(cash)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Card fee @ {cardFeePct.toFixed(1)}%</p>
              <p className="font-semibold tabular-nums text-orange-600">{money(cardFee)}</p>
            </div>
          </div>
        </div>
      )}

      {ddGross > 0 && (
        <div>
          <p className="text-xs uppercase text-gray-500 mb-2">DoorDash commission &amp; fees</p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">Gross</p>
              <p className="font-semibold tabular-nums">{money(ddGross)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Commission + fees</p>
              <p className="font-semibold tabular-nums text-orange-600">{money(ddTotalFees)}</p>
              <p className="text-[11px] text-gray-500">{ddPct.toFixed(1)}% of gross</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Actual payout</p>
              <p className="font-semibold tabular-nums">{money(pulse.by_channel?.doordash?.net ?? 0)}</p>
            </div>
          </div>
        </div>
      )}

      <div className="border-t pt-3 flex items-center justify-between">
        <p className="text-sm">
          <span className="text-gray-500">Total silent fees this window: </span>
          <strong className="tabular-nums text-orange-600">{money(totalSilent)}</strong>
        </p>
        <p className="text-xs text-gray-400">
          GoDaddy ~{cardFeePct.toFixed(1)}% × card + DoorDash actual payout split
        </p>
      </div>
    </div>
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
        <>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <span className="text-gray-700">
              <span className="text-gray-500">Window total:</span>{' '}
              <span className="font-semibold tabular-nums">
                ${(data.window_total_gross ?? 0).toLocaleString('en-US', {
                  minimumFractionDigits: 2, maximumFractionDigits: 2,
                })}
              </span>{' '}
              <span className="text-gray-500">/ </span>
              <span className="font-semibold tabular-nums">
                {(data.window_total_txns ?? 0).toLocaleString('en-US')}
              </span>{' '}
              <span className="text-gray-500">txns</span>
            </span>
            <span className="text-gray-500">
              Cells = avg per day-of-week across this window · GoDaddy + TapMango only (DoorDash has no hourly data)
            </span>
          </div>
          <HeatmapGrid
            grid={data.grid}
            maxValue={data.max_value}
            granularity={data.granularity}
            metric={data.metric}
          />
        </>
      )}
    </Card>
  );
}

// Operating hours only — hide overnight dead zone. Shops are closed
// 8pm–5am so showing those slots was wasted real estate; suppressing
// them lets the remaining cells stretch wide enough to show the value
// inline without hover.
const HEATMAP_OPEN_HOUR = 5;   // inclusive, 5am
const HEATMAP_CLOSE_HOUR = 20; // exclusive, 8pm

function HeatmapGrid({
  grid, maxValue, granularity, metric,
}: {
  grid: number[][];
  maxValue: number;
  granularity: 'hour' | 'quarter';
  metric: 'txns' | 'gross';
}) {
  // Slot windows inside the visible band. Hours: 5..19 inclusive (15
  // slots). Quarter: 20..79 inclusive (60 slots).
  const slotStart = granularity === 'hour'
    ? HEATMAP_OPEN_HOUR
    : HEATMAP_OPEN_HOUR * 4;
  const slotEnd = granularity === 'hour'
    ? HEATMAP_CLOSE_HOUR
    : HEATMAP_CLOSE_HOUR * 4;
  const visibleCount = slotEnd - slotStart;

  const cellWidth = granularity === 'hour' ? 56 : 26;
  const cellHeight = granularity === 'hour' ? 40 : 34;

  const fmt = (v: number) => metric === 'gross'
    ? `$${Math.round(v).toLocaleString('en-US')}`
    : v.toFixed(1);

  // Compact inline label. In 15-min mode the cells are tight, so drop
  // the $ sign to keep the number readable — the header already says
  // this is revenue dollars.
  const fmtCell = (v: number) => {
    if (v <= 0) return '';
    if (metric === 'gross') {
      if (granularity === 'quarter') {
        if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
        return `${Math.round(v)}`;
      }
      if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
      return `$${Math.round(v)}`;
    }
    return v >= 10 ? v.toFixed(0) : v.toFixed(1);
  };

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
      if (q !== 0) return '';
      return h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
    }
  };

  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        {/* Hour labels */}
        <div className="flex pl-10">
          {Array.from({ length: visibleCount }).map((_, i) => {
            const s = slotStart + i;
            return (
              <div
                key={s}
                className="text-[10px] text-gray-500 text-center"
                style={{ width: cellWidth }}
              >
                {slotLabel(s)}
              </div>
            );
          })}
        </div>
        {/* DOW rows */}
        {grid.map((row, dow) => (
          <div key={dow} className="flex items-center">
            <div className="w-10 text-xs text-gray-600 pr-2 text-right">
              {DOW_LABELS[dow]}
            </div>
            {Array.from({ length: visibleCount }).map((_, i) => {
              const s = slotStart + i;
              const v = row[s] ?? 0;
              const intensity = maxValue > 0 ? v / maxValue : 0;
              const label = fmtCell(v);
              const textColor = intensity > 0.55 ? 'white' : '#374151';
              return (
                <div
                  key={s}
                  title={`${DOW_LABELS[dow]} ${slotLabel(s) || `slot ${s}`} · ${fmt(v)}`}
                  style={{
                    width: cellWidth,
                    height: cellHeight,
                    backgroundColor: heatColor(intensity),
                    color: textColor,
                  }}
                  className="border border-white flex items-center justify-center text-[10px] font-medium tabular-nums"
                >
                  {label}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mt-2">
        Showing {HEATMAP_OPEN_HOUR}am–{HEATMAP_CLOSE_HOUR - 12}pm. Overnight
        hours are hidden.
      </p>
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

// -------------------------------------------------------------
// Data freshness banner — flags days missing in the selected window
// -------------------------------------------------------------

const SOURCE_LABEL: Record<string, string> = {
  godaddy:  'GoDaddy',
  tapmango: 'TapMango',
  doordash: 'DoorDash',
  homebase: 'Homebase labor',
};

function DataFreshnessBanner({ window }: { window: InsightsWindow }) {
  const { data } = useQuery({
    queryKey: ['insights-freshness', JSON.stringify(window)],
    queryFn: () => insights.dataFreshness(window),
  });

  if (!data) return null;

  const gaps = Object.entries(data.sources)
    .filter(([, s]) => s.missing > 0)
    .map(([src, s]) => ({ src, ...s }));

  if (gaps.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>All 4 sources have data for every day in this window.</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-medium mb-1">Some sources have missing days in this window:</p>
        <ul className="space-y-0.5">
          {gaps.map((g) => (
            <li key={g.src} title={`Missing dates: ${g.missing_dates.join(', ')}`}>
              <span className="font-medium">{SOURCE_LABEL[g.src] ?? g.src}</span>:
              {' '}missing {g.missing} of {data.window.days} days
              {g.latest_present && ` · latest data ${g.latest_present}`}
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-amber-700 mt-1">
          Drop the missing files on the Analytics Ingestion page — they'll silently replace whatever's there.
        </p>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Elite scorecards — per-store P&L grade + action queue
// -------------------------------------------------------------

const GRADE_STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  GREEN:    { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  label: 'GREEN' },
  YELLOW:   { bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-200', label: 'YELLOW' },
  ORANGE:   { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', label: 'ORANGE' },
  RED:      { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    label: 'RED' },
  'INFO ONLY': { bg: 'bg-gray-50', text: 'text-gray-600',  border: 'border-gray-200',   label: 'INFO ONLY' },
};

function EliteSection({ window }: { window: InsightsWindow }) {
  const { data, isLoading } = useQuery({
    queryKey: ['insights-elite', JSON.stringify(window)],
    queryFn: () => insights.eliteScorecards(window),
  });

  if (isLoading || !data) return null;

  const money = (v: number | null | undefined) =>
    v == null ? 'n/a'
    : `$${Math.round(v).toLocaleString('en-US')}`;
  const money2 = (v: number | null | undefined) =>
    v == null ? 'n/a'
    : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (v: number | null | undefined) =>
    v == null ? 'n/a' : `${v.toFixed(1)}%`;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Elite Scorecards</h2>
        <div className="text-xs text-gray-500">
          Labor burden {data.settings.labor_burden_multiplier.toFixed(2)}× ·
          COGS {(data.settings.cogs_percent * 100).toFixed(0)}% ·
          Target labor {(data.settings.target_labor_pct * 100).toFixed(0)}% ·
          Overhead allocated by revenue share
        </div>
      </div>

      {/* Company roll-up */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <RollupTile label="Revenue"        value={money(data.company.gross)} />
        <RollupTile label="True profit"    value={money(data.company.profit)}
                    tone={data.company.profit < 0 ? 'red' : undefined} />
        <RollupTile label="Margin"         value={pct(data.company.margin_pct)} />
        <RollupTile label="Labor opp."     value={money(data.company.labor_opportunity)}
                    tone={data.company.labor_opportunity > 1000 ? 'orange' : undefined} />
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Projected profit if the labor opportunity is captured:
        {' '}<strong>{money(data.company.projected_profit_if_fixed)}</strong>
      </p>

      {/* Priority queue */}
      {data.priority_queue.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">This week's focus</h3>
          <ol className="list-decimal list-inside space-y-1 text-sm">
            {data.priority_queue.map((a: any, i: number) => (
              <li key={i}>
                <span className={clsx('font-semibold', GRADE_STYLE[a.grade]?.text)}>
                  {a.store}
                </span>
                {' — '}
                {a.action}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Per-store cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {data.scorecards.map((s: any) => {
          const g = GRADE_STYLE[s.grade] ?? GRADE_STYLE['INFO ONLY'];
          return (
            <div
              key={s.location_id}
              className={clsx('border rounded-lg p-3', g.border, g.bg)}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 truncate">{s.name}</h4>
                  <p className="text-[10px] text-gray-500 font-mono">{s.canonical_short_name}</p>
                </div>
                <div className="text-right">
                  <div className={clsx('text-xs font-bold', g.text)}>{g.label}</div>
                  <div className="text-[10px] text-gray-500">{s.score}/100</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                <div className="text-gray-500">Revenue</div>
                <div className="text-right font-medium tabular-nums">
                  {money2(s.current.gross)}
                </div>
                <div className="text-gray-500">Profit</div>
                <div className={clsx(
                  'text-right font-medium tabular-nums',
                  s.current.profit < 0 && 'text-red-600',
                )}>
                  {money2(s.current.profit)}
                </div>
                <div className="text-gray-500">Margin</div>
                <div className="text-right tabular-nums">{pct(s.current.margin_pct)}</div>
                <div className="text-gray-500">Labor %</div>
                <div className={clsx(
                  'text-right tabular-nums',
                  (s.current.labor_pct ?? 0) > 35 && 'text-orange-600 font-medium',
                )}>
                  {pct(s.current.labor_pct)}
                </div>
                {s.current.shared_overhead_share > 0 && (
                  <>
                    <div className="text-gray-500">Shared overhead</div>
                    <div className="text-right tabular-nums text-gray-600">
                      {money2(s.current.shared_overhead_share)}
                    </div>
                  </>
                )}
                <div className="text-gray-500">Hours</div>
                <div className="text-right tabular-nums">{s.current.hours}</div>
                <div className="text-gray-500">$/labor hr</div>
                <div className="text-right tabular-nums">
                  {s.current.avg_splh != null ? `$${s.current.avg_splh.toFixed(2)}` : 'n/a'}
                </div>
                {s.current.labor_opportunity > 0 && (
                  <>
                    <div className="text-gray-500">Labor opp.</div>
                    <div className="text-right text-orange-600 font-medium tabular-nums">
                      {money(s.current.labor_opportunity)}
                    </div>
                  </>
                )}
              </div>

              {s.profit_sparkline_28d && s.profit_sparkline_28d.length > 0 && (
                <div className="mt-2 pt-2 border-t border-black/5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-gray-500">28-day profit</span>
                    <Sparkline values={s.profit_sparkline_28d} />
                  </div>
                </div>
              )}

              <div className="mt-2 pt-2 border-t border-black/5 text-[11px] text-gray-700">
                <span className="font-medium">Action: </span>{s.primary_action}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RollupTile({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'orange' }) {
  return (
    <div className={clsx(
      'border rounded-md p-2 bg-white',
      tone === 'red'    && 'border-red-200',
      tone === 'orange' && 'border-orange-200',
      !tone             && 'border-gray-100',
    )}>
      <p className="text-[10px] text-gray-500 uppercase">{label}</p>
      <p className={clsx(
        'text-base font-bold tabular-nums',
        tone === 'red' && 'text-red-600',
        tone === 'orange' && 'text-orange-600',
      )}>{value}</p>
    </div>
  );
}
