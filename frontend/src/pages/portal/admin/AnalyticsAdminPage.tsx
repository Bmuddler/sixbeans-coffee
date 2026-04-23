import { useRef, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { clsx } from 'clsx';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Link2,
  ShieldCheck,
  Mail,
  Cookie,
  Upload,
  Clock,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { analyticsAdmin, analyticsAdminUploads, locations as locationsApi } from '@/lib/api';

type SessionStatus = {
  source: string;
  connected: boolean;
  captured_at: string | null;
  last_used_at: string | null;
  last_failure_at: string | null;
  last_failure_reason: string | null;
};

const SOURCE_META: Record<
  string,
  { label: string; blurb: string; loginHint: string; icon: typeof Cookie }
> = {
  godaddy: {
    label: 'GoDaddy Commerce',
    blurb: 'Local Cowork task uploads Transactions Reports nightly',
    loginHint: 'https://spa.commerce.godaddy.com/home/store',
    icon: Cookie,
  },
  tapmango_portal: {
    label: 'TapMango Portal',
    blurb: 'Local Cowork task uploads Orders CSV nightly',
    loginHint: 'https://portal.tapmango.com/Orders/Index',
    icon: Cookie,
  },
  gmail_oauth: {
    label: 'Gmail (DoorDash watcher)',
    blurb: 'Weekly DoorDash email watcher on blend556@gmail.com',
    loginHint: 'Uses Google OAuth consent',
    icon: Mail,
  },
};

export function AnalyticsAdminPage() {
  const qc = useQueryClient();

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['analytics-admin-sessions'],
    queryFn: analyticsAdmin.listSessions,
  });

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['analytics-admin-runs'],
    queryFn: () => analyticsAdmin.listRuns({ limit: 20 }),
    refetchInterval: 30000,
  });

  const { data: unknownData } = useQuery({
    queryKey: ['analytics-admin-unknown'],
    queryFn: analyticsAdmin.listUnknownStores,
  });

  const { data: locationsList } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsApi.list,
  });

  const uploadMutation = useMutation({
    mutationFn: ({ source, json }: { source: 'godaddy' | 'tapmango_portal'; json: any }) =>
      analyticsAdmin.uploadSession(source, json),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['analytics-admin-sessions'] });
      setUploadModal(null);
      setUploadText('');
      toast.success('Session saved');
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.detail ?? 'Failed to save session'),
  });

  const triggerMutation = useMutation({
    mutationFn: (source: string) => analyticsAdmin.triggerRun(source),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['analytics-admin-runs'] });
      if (data?.status === 'skipped') {
        toast(data.reason ?? 'Use Render dashboard to trigger', { icon: 'ℹ️' });
      } else {
        toast.success(`Ran — status: ${data?.status ?? 'done'}`);
      }
    },
    onError: () => toast.error('Run failed'),
  });

  const assignMutation = useMutation({
    mutationFn: ({ source, externalId, locationId }: {
      source: string; externalId: string; locationId: number;
    }) => analyticsAdmin.assignMapping(source, externalId, locationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['analytics-admin-unknown'] });
      toast.success('Mapping saved');
    },
    onError: () => toast.error('Failed to save mapping'),
  });

  const [uploadModal, setUploadModal] = useState<
    null | 'godaddy' | 'tapmango_portal'
  >(null);
  const [uploadText, setUploadText] = useState('');

  const sessions = sessionsData?.sources ?? [];
  const unmapped = unknownData?.unmapped ?? [];

  const handleGmailConnect = async () => {
    try {
      const res = await analyticsAdmin.gmailOauthStart();
      window.location.href = res.url;
    } catch {
      toast.error('Could not start Gmail consent flow');
    }
  };

  const handleUploadSubmit = () => {
    if (!uploadModal) return;
    let parsed: any;
    try {
      parsed = JSON.parse(uploadText);
    } catch {
      toast.error('Invalid JSON — paste the full storage_state object');
      return;
    }
    uploadMutation.mutate({ source: uploadModal, json: parsed });
  };

  const gmailStatus = sessions.find((s) => s.source === 'gmail_oauth');

  // GoDaddy and TapMango Portal are driven by Cowork uploads, not the
  // Render-side cookie vault — their status comes from recent IngestionRun
  // rows (tapmango_orders is the backend source key for TapMango Portal).
  const godaddyLastRun = runs?.find((r: any) => r.source === 'godaddy');
  const tapmangoLastRun = runs?.find((r: any) => r.source === 'tapmango_orders');
  const localWorkflowSources = new Set(['godaddy', 'tapmango_portal']);
  const lastRunBySource: Record<string, any> = {
    godaddy: godaddyLastRun,
    tapmango_portal: tapmangoLastRun,
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Analytics Ingestion</h1>
        <p className="text-sm text-gray-500">
          Connect the 3 data sources and monitor nightly sync status.
        </p>
      </div>

      {/* Data source connections */}
      <Card>
        <h2 className="text-lg font-semibold mb-4">Data Sources</h2>
        <div className="space-y-3">
          {sessionsLoading && <p className="text-sm text-gray-500">Loading…</p>}
          {sessions.map((s: SessionStatus) => {
            const meta = SOURCE_META[s.source];
            if (!meta) return null;
            const Icon = meta.icon;
            return (
              <div
                key={s.source}
                className="flex items-center gap-4 border border-gray-200 rounded-lg p-4"
              >
                <div className="h-10 w-10 bg-gray-100 rounded-lg flex items-center justify-center">
                  <Icon className="h-5 w-5 text-gray-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{meta.label}</p>
                    {localWorkflowSources.has(s.source) ? (
                      <LocalWorkflowBadge lastRun={lastRunBySource[s.source]} />
                    ) : (
                      <StatusBadge session={s} />
                    )}
                  </div>
                  <p className="text-sm text-gray-500">{meta.blurb}</p>

                  {localWorkflowSources.has(s.source) ? (
                    lastRunBySource[s.source] ? (
                      <p className="text-xs text-gray-400 mt-1">
                        Last upload:{' '}
                        {new Date(lastRunBySource[s.source].started_at).toLocaleString()}
                        {lastRunBySource[s.source].status &&
                          ` · ${lastRunBySource[s.source].status}`}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-1">
                        Waiting for first Cowork upload
                      </p>
                    )
                  ) : (
                    <>
                      {s.captured_at && (
                        <p className="text-xs text-gray-400 mt-1">
                          Connected {new Date(s.captured_at).toLocaleString()}
                          {s.last_used_at &&
                            ` · last sync ${new Date(s.last_used_at).toLocaleString()}`}
                        </p>
                      )}
                      {s.last_failure_reason && (
                        <p className="text-xs text-red-600 mt-1">
                          Last failure: {s.last_failure_reason}
                        </p>
                      )}
                    </>
                  )}
                </div>

                {localWorkflowSources.has(s.source) ? (
                  <span className="text-xs text-gray-400 italic">
                    Local workflow
                  </span>
                ) : s.source === 'gmail_oauth' ? (
                  <Button
                    size="sm"
                    onClick={handleGmailConnect}
                    icon={<Link2 className="h-4 w-4" />}
                  >
                    {s.connected ? 'Reconnect' : 'Connect Gmail'}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setUploadModal(s.source as 'godaddy' | 'tapmango_portal')
                    }
                    icon={<Cookie className="h-4 w-4" />}
                  >
                    {s.connected ? 'Replace cookies' : 'Upload cookies'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Unknown stores */}
      {unmapped.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-semibold">New stores detected</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            These store IDs appeared in ingested data but aren't mapped to any
            location yet. Pick a location for each.
          </p>
          <div className="space-y-3">
            {unmapped.map((group: any) =>
              group.external_ids.map((eid: string) => (
                <div
                  key={`${group.source}-${eid}`}
                  className="flex items-center gap-3 border border-gray-200 rounded-lg p-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm text-gray-900">{eid}</p>
                    <p className="text-xs text-gray-500">{group.source}</p>
                  </div>
                  <select
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                    defaultValue=""
                    onChange={(e) => {
                      const locId = parseInt(e.target.value, 10);
                      if (!locId) return;
                      assignMutation.mutate({
                        source: group.source,
                        externalId: eid,
                        locationId: locId,
                      });
                    }}
                  >
                    <option value="">Map to a location…</option>
                    {locationsList?.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>
              )),
            )}
          </div>
        </Card>
      )}

      {/* Homebase timesheets upload */}
      <HomebaseUploadCard onUploaded={() => qc.invalidateQueries({ queryKey: ['analytics-admin-runs'] })} />

      {/* Manual triggers + run history */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent runs</h2>
          <div className="flex gap-2">
            {['tapmango_api', 'doordash'].map((src) => (
              <Button
                key={src}
                size="sm"
                variant="secondary"
                onClick={() => triggerMutation.mutate(src)}
                loading={triggerMutation.isPending && triggerMutation.variables === src}
                icon={<RefreshCw className="h-4 w-4" />}
              >
                Run {src.replace('_', ' ')}
              </Button>
            ))}
          </div>
        </div>

        {runsLoading ? (
          <p className="text-sm text-gray-500">Loading runs…</p>
        ) : !runs || runs.length === 0 ? (
          <p className="text-sm text-gray-500">No runs yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {runs.map((r: any) => (
              <div key={r.id} className="py-3 flex items-center gap-3">
                <RunStatusIcon status={r.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{r.source}</span>
                    <span className="text-xs text-gray-400">{r.target_date}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {new Date(r.started_at).toLocaleString()}
                    {r.records_ingested != null && ` · ${r.records_ingested} records`}
                    {r.status && ` · ${r.status}`}
                  </p>
                  {r.error_message && (
                    <p className="text-xs text-red-600 mt-1 truncate">
                      {r.error_message}
                    </p>
                  )}
                  {r.notes && (
                    <p className="text-xs text-gray-500 mt-1">{r.notes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Upload cookies modal */}
      <Modal
        open={!!uploadModal}
        onClose={() => {
          setUploadModal(null);
          setUploadText('');
        }}
        title={
          uploadModal
            ? `Upload ${SOURCE_META[uploadModal].label} cookies`
            : 'Upload cookies'
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            1. Log in at{' '}
            <span className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">
              {uploadModal ? SOURCE_META[uploadModal].loginHint : ''}
            </span>
          </p>
          <p className="text-sm text-gray-600">
            2. Open DevTools → Application → Cookies → right-click → Export, OR
            run{' '}
            <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
              context.storage_state()
            </code>{' '}
            from a Playwright session
          </p>
          <p className="text-sm text-gray-600">
            3. Paste the full JSON below:
          </p>
          <textarea
            className="w-full h-48 border border-gray-300 rounded-lg p-2 font-mono text-xs"
            value={uploadText}
            onChange={(e) => setUploadText(e.target.value)}
            placeholder='{"cookies": [...], "origins": [...]}'
          />
          <Button
            onClick={handleUploadSubmit}
            loading={uploadMutation.isPending}
            disabled={!uploadText.trim()}
            className="w-full"
          >
            Save cookies
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function StatusBadge({ session }: { session: SessionStatus }) {
  if (!session.captured_at) {
    return (
      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
        not connected
      </span>
    );
  }
  if (session.last_failure_at && (!session.last_used_at ||
    new Date(session.last_failure_at) > new Date(session.last_used_at))) {
    return (
      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
        needs reconnect
      </span>
    );
  }
  return (
    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
      connected
    </span>
  );
}

function RunStatusIcon({ status }: { status: string }) {
  const common = 'h-5 w-5 flex-shrink-0';
  if (status === 'success') return <CheckCircle2 className={clsx(common, 'text-green-500')} />;
  if (status === 'partial')
    return <AlertTriangle className={clsx(common, 'text-orange-500')} />;
  if (status === 'failed') return <XCircle className={clsx(common, 'text-red-500')} />;
  if (status === 'running')
    return <RefreshCw className={clsx(common, 'text-blue-500 animate-spin')} />;
  return <ShieldCheck className={clsx(common, 'text-gray-400')} />;
}

function LocalWorkflowBadge({ lastRun }: { lastRun: any }) {
  if (!lastRun) {
    return (
      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
        awaiting upload
      </span>
    );
  }
  // Fresh = uploaded within the last 36 hours
  const ageMs = Date.now() - new Date(lastRun.started_at).getTime();
  const fresh = ageMs < 36 * 60 * 60 * 1000;
  if (lastRun.status === 'success' && fresh) {
    return (
      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
        synced
      </span>
    );
  }
  if (lastRun.status === 'failed') {
    return (
      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
        last upload failed
      </span>
    );
  }
  return (
    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
      stale (no recent upload)
    </span>
  );
}

function HomebaseUploadCard({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  const mutation = useMutation({
    mutationFn: (files: File[]) => analyticsAdminUploads.homebaseTimesheets(files),
    onSuccess: (data) => {
      setResult(data);
      const rows = data?.rows_ingested ?? 0;
      toast.success(`Ingested ${rows} day-store rows`);
      onUploaded();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail ?? 'Upload failed');
    },
  });

  const accept = (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith('.csv'));
    if (!files.length) {
      toast.error('Drop one or more .csv Homebase timesheet exports');
      return;
    }
    mutation.mutate(files);
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <Clock className="h-5 w-5 text-blue-500" />
        <h2 className="text-lg font-semibold">Homebase labor</h2>
        <span className="text-xs text-gray-400">
          Drop the weekly timesheet CSVs (one per store)
        </span>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) accept(e.dataTransfer.files);
        }}
        className={clsx(
          'border-2 border-dashed rounded-lg px-4 py-8 text-center cursor-pointer transition-colors',
          dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400',
          mutation.isPending && 'opacity-50 pointer-events-none',
        )}
      >
        <Upload className="h-7 w-7 text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-700">
          {mutation.isPending ? 'Uploading…' : 'Drag CSVs here, or click to pick files'}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Export from Homebase → Timesheets → Export CSV, one file per location.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) accept(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {result && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-gray-700">
            {result.rows_ingested} store-days ingested
            {result.date_range?.start && result.date_range?.end &&
              ` · ${result.date_range.start} → ${result.date_range.end}`}
          </p>
          <div className="divide-y divide-gray-100 border border-gray-100 rounded-md">
            {result.per_file?.map((pf: any, i: number) => (
              <div key={i} className="px-3 py-2 flex items-start gap-2">
                {pf.error ? (
                  <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-gray-700 truncate">{pf.file}</p>
                  {pf.error ? (
                    <p className="text-xs text-red-600">{pf.error}</p>
                  ) : (
                    <p className="text-xs text-gray-500">
                      {pf.header_short} · {pf.rows_ingested} day-rows · {pf.excluded_rows} owner rows excluded
                      {pf.unknown_short_names?.length > 0 &&
                        ` · unknown store: ${pf.unknown_short_names.join(', ')}`}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
