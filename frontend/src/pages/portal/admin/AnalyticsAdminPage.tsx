import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { clsx } from 'clsx';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Mail,
  Upload,
  ShieldCheck,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { analyticsAdmin, analyticsAdminUploads, locations as locationsApi } from '@/lib/api';

const SOURCE_LABELS: Record<string, { label: string; icon: typeof Upload; color: string }> = {
  godaddy:             { label: 'GoDaddy Commerce',     icon: Upload, color: '#5CB832' },
  godaddy_settlement:  { label: 'GoDaddy Settlement',   icon: Upload, color: '#5CB832' },
  tapmango:            { label: 'TapMango Orders',      icon: Upload, color: '#F59E0B' },
  doordash:            { label: 'DoorDash Financials',  icon: Upload, color: '#EF4444' },
  homebase:            { label: 'Homebase Timesheets',  icon: Upload, color: '#3B82F6' },
};

export function AnalyticsAdminPage() {
  const qc = useQueryClient();

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

  const triggerMutation = useMutation({
    mutationFn: (source: string) => analyticsAdmin.triggerRun(source),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['analytics-admin-runs'] });
      toast.success(`Ran — status: ${data?.status ?? 'done'}`);
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

  const unmapped = unknownData?.unmapped ?? [];

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Analytics Ingestion</h1>
        <p className="text-sm text-gray-500">
          Drop your daily files — GoDaddy, TapMango, DoorDash, Homebase — in one place.
          Re-uploading the same day silently replaces the old data, never doubles.
        </p>
      </div>

      <UnifiedUploadCard
        onUploaded={() => {
          qc.invalidateQueries({ queryKey: ['analytics-admin-runs'] });
          qc.invalidateQueries({ queryKey: ['analytics-admin-unknown'] });
        }}
      />

      {/* Unknown stores (mapping) */}
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

      {/* Run history */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent runs</h2>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => triggerMutation.mutate('tapmango_api')}
              loading={triggerMutation.isPending && triggerMutation.variables === 'tapmango_api'}
              icon={<RefreshCw className="h-4 w-4" />}
            >
              Run TapMango API health-check
            </Button>
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
    </div>
  );
}

// -------------------------------------------------------------
// Unified drop zone — one handler for all 4 sources
// -------------------------------------------------------------

function UnifiedUploadCard({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  const mutation = useMutation({
    mutationFn: (files: File[]) => analyticsAdminUploads.batch(files),
    onSuccess: (data) => {
      setResult(data);
      const ok = (data.per_file ?? []).filter((pf: any) => !pf.error).length;
      const fail = (data.per_file ?? []).length - ok;
      toast.success(
        `Uploaded ${ok} file${ok === 1 ? '' : 's'}` +
          (fail > 0 ? ` · ${fail} with errors` : ''),
      );
      onUploaded();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail ?? 'Upload failed');
    },
  });

  const accept = (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    mutation.mutate(files);
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-2">
        <Upload className="h-5 w-5 text-blue-500" />
        <h2 className="text-lg font-semibold">Drop your daily data</h2>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Mix and match. Filename tells the server which source it is:
        <code className="mx-1 text-[11px] bg-gray-100 px-1 rounded">godaddy_&lt;uuid&gt;_YYYY-MM-DD.xlsx</code> ·
        <code className="mx-1 text-[11px] bg-gray-100 px-1 rounded">settlement-*.xlsx</code> ·
        <code className="mx-1 text-[11px] bg-gray-100 px-1 rounded">Orders_YYYYMMDD_YYYYMMDD_.csv</code> ·
        <code className="mx-1 text-[11px] bg-gray-100 px-1 rounded">financial_*.zip</code> ·
        <code className="mx-1 text-[11px] bg-gray-100 px-1 rounded">*_timesheets.csv</code>
      </p>

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
          'border-2 border-dashed rounded-lg px-4 py-10 text-center cursor-pointer transition-colors',
          dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400',
          mutation.isPending && 'opacity-50 pointer-events-none',
        )}
      >
        <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-700">
          {mutation.isPending ? 'Uploading…' : 'Drag files here, or click to pick'}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          GoDaddy Excel · TapMango CSV · DoorDash ZIP · Homebase CSV
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.zip"
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
          <div className="divide-y divide-gray-100 border border-gray-100 rounded-md">
            {result.per_file?.map((pf: any, i: number) => (
              <div key={i} className="px-3 py-2 flex items-start gap-2">
                {pf.error ? (
                  <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-gray-700 truncate">
                    {pf.file}
                    {pf.source && (
                      <span
                        className="ml-2 text-[10px] px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: (SOURCE_LABELS[pf.source]?.color ?? '#999') + '22',
                          color: SOURCE_LABELS[pf.source]?.color ?? '#666',
                        }}
                      >
                        {SOURCE_LABELS[pf.source]?.label ?? pf.source}
                      </span>
                    )}
                  </p>
                  {pf.error ? (
                    <p className="text-xs text-red-600">{pf.error}</p>
                  ) : (
                    <p className="text-xs text-gray-500">
                      {pf.source === 'godaddy' &&
                        `${pf.location} · ${pf.date} · $${pf.gross?.toFixed?.(2)} · ${pf.txns} txns`}
                      {pf.source === 'godaddy_settlement' &&
                        `${pf.location} · ${pf.days} day${pf.days === 1 ? '' : 's'} · ${pf.date_range ?? ''}`}
                      {pf.source === 'tapmango' &&
                        `${pf.date} · ${pf.stores} store${pf.stores === 1 ? '' : 's'}`}
                      {pf.source === 'doordash' &&
                        `${pf.stores} store${pf.stores === 1 ? '' : 's'} · ${pf.date_range ?? ''}`}
                      {pf.source === 'homebase' &&
                        `${pf.header_store} · ${pf.rows_ingested} day-rows · ${pf.excluded_rows} owner rows excluded`}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {result.unmapped_ids && Object.keys(result.unmapped_ids).length > 0 && (
            <div className="text-xs bg-orange-50 border border-orange-200 text-orange-800 rounded-md p-3">
              <p className="font-medium mb-1">Unmapped store IDs — map below in "New stores detected":</p>
              {Object.entries(result.unmapped_ids).map(([src, ids]: any) => (
                <div key={src}>
                  <span className="font-mono">{src}:</span> {(ids as string[]).join(', ')}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// -------------------------------------------------------------
// Icons
// -------------------------------------------------------------

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
