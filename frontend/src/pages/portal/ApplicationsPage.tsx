import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase,
  Send,
  Archive,
  Trash2,
  Mail,
  Phone,
  MapPin,
  ChevronDown,
  ChevronUp,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { applications, locations as locationsApi } from '@/lib/api';

type Rating = 'yes' | 'maybe' | 'never';

interface JobApp {
  id: number;
  name: string;
  email: string;
  phone: string;
  position: string;
  location: string;
  message: string | null;
  created_at: string;
  status: 'new' | 'forwarded' | 'rejected' | 'archived';
  rating: Rating | null;
  forwarded_to_location_id: number | null;
  forwarded_to_location_name: string | null;
  forwarded_at: string | null;
  rejected_at: string | null;
}

interface LocationRow {
  id: number;
  name: string;
}

function statusBadge(s: JobApp['status']) {
  if (s === 'forwarded') return <Badge variant="approved">Forwarded</Badge>;
  if (s === 'rejected') return <Badge variant="denied">Rejected</Badge>;
  if (s === 'archived') return <Badge variant="denied">Archived</Badge>;
  return <Badge variant="pending">New</Badge>;
}

const RATING_STYLES: Record<Rating, { active: string; idle: string; label: string }> = {
  yes:   { active: 'bg-green-600 text-white border-green-600',   idle: 'bg-white text-green-700 border-green-300 hover:bg-green-50',   label: 'Yes' },
  maybe: { active: 'bg-yellow-500 text-white border-yellow-500', idle: 'bg-white text-yellow-700 border-yellow-300 hover:bg-yellow-50', label: 'Maybe' },
  never: { active: 'bg-gray-700 text-white border-gray-700',     idle: 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100',      label: 'Never' },
};

function extractError(err: any, fallback: string): string {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  return err?.message ?? fallback;
}

export function ApplicationsPage() {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [forwardingApp, setForwardingApp] = useState<JobApp | null>(null);
  const [forwardLocationId, setForwardLocationId] = useState<string>('');

  const { data: apps, isLoading } = useQuery<JobApp[]>({
    queryKey: ['applications', showArchived],
    queryFn: () => applications.list(showArchived),
  });

  const { data: locsData } = useQuery<LocationRow[]>({
    queryKey: ['locations'],
    queryFn: locationsApi.list,
  });

  const locationOptions = useMemo(
    () => [
      { value: '', label: 'Select a shop…' },
      ...((locsData ?? []).map((l) => ({ value: String(l.id), label: l.name }))),
    ],
    [locsData],
  );

  const forwardMutation = useMutation({
    mutationFn: ({ id, locationId }: { id: number; locationId: number }) => applications.forward(id, locationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast.success('Emailed location managers');
      setForwardingApp(null);
      setForwardLocationId('');
    },
    onError: (err: any) => toast.error(extractError(err, 'Failed to forward')),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => applications.reject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast.success('Rejection email sent');
    },
    onError: (err: any) => toast.error(extractError(err, 'Failed to send rejection')),
  });

  const rateMutation = useMutation({
    mutationFn: ({ id, rating }: { id: number; rating: Rating | null }) => applications.rate(id, rating),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['applications'] }),
    onError: (err: any) => toast.error(extractError(err, 'Failed to update rating')),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: number) => applications.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast.success('Application archived');
    },
    onError: (err: any) => toast.error(extractError(err, 'Failed to archive')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => applications.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast.success('Application deleted');
    },
    onError: (err: any) => toast.error(extractError(err, 'Failed to delete')),
  });

  const list = apps ?? [];
  const newCount = list.filter((a) => a.status === 'new').length;

  // Group: position → location-applied-for → apps (newest first; backend already
  // orders by created_at desc, but we sort here too in case order shifts).
  const grouped = useMemo(() => {
    const byPos = new Map<string, Map<string, JobApp[]>>();
    for (const a of list) {
      const pos = a.position?.trim() || 'Unspecified position';
      const loc = a.location?.trim() || 'Unspecified shop';
      if (!byPos.has(pos)) byPos.set(pos, new Map());
      const inner = byPos.get(pos)!;
      if (!inner.has(loc)) inner.set(loc, []);
      inner.get(loc)!.push(a);
    }
    for (const inner of byPos.values()) {
      for (const arr of inner.values()) {
        arr.sort((x, y) => y.created_at.localeCompare(x.created_at));
      }
    }
    return Array.from(byPos.entries()).map(([pos, inner]) => ({
      position: pos,
      groups: Array.from(inner.entries()).map(([loc, items]) => ({ location: loc, items })),
    }));
  }, [list]);

  const submitForward = () => {
    if (!forwardingApp || !forwardLocationId) {
      toast.error('Pick a shop first');
      return;
    }
    forwardMutation.mutate({ id: forwardingApp.id, locationId: Number(forwardLocationId) });
  };

  const handleRate = (app: JobApp, rating: Rating) => {
    const next = app.rating === rating ? null : rating;
    rateMutation.mutate({ id: app.id, rating: next });
  };

  const handleReject = (app: JobApp) => {
    if (!confirm(`Send the 'not currently hiring' email to ${app.name} (${app.email})?`)) return;
    rejectMutation.mutate(app.id);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Job Applications</h1>
          <p className="page-subtitle">
            {list.length} application{list.length === 1 ? '' : 's'}
            {newCount > 0 ? ` · ${newCount} new` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={showArchived ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card><LoadingSpinner size="sm" /></Card>
      ) : list.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <Briefcase className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              {showArchived ? 'No applications yet.' : 'No applications. Toggle "Show archived" for older ones.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ position, groups }) => (
            <div key={position}>
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-primary" />
                {position}
                <span className="text-sm font-normal text-gray-500">
                  · {groups.reduce((n, g) => n + g.items.length, 0)} applicant{groups.reduce((n, g) => n + g.items.length, 0) === 1 ? '' : 's'}
                </span>
              </h2>
              <div className="space-y-5">
                {groups.map(({ location, items }) => (
                  <div key={location}>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 ml-1">
                      Applied for {location} · {items.length}
                    </h3>
                    <div className="space-y-2">
                      {items.map((app) => {
                        const isExpanded = expandedId === app.id;
                        return (
                          <Card key={app.id} className="!p-0 overflow-hidden">
                            <div className="p-4">
                              <div className="flex items-start justify-between gap-4 flex-wrap">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-base font-semibold text-gray-900">{app.name}</p>
                                    {statusBadge(app.status)}
                                    <span className="text-xs text-gray-400">
                                      {new Date(app.created_at).toLocaleDateString()}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
                                    <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{app.email}</span>
                                    <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{app.phone}</span>
                                    {app.forwarded_to_location_name && (
                                      <span className="flex items-center gap-1 text-green-600">
                                        <MapPin className="h-3 w-3" />
                                        Forwarded to {app.forwarded_to_location_name}
                                        {app.forwarded_at ? ` · ${new Date(app.forwarded_at).toLocaleDateString()}` : ''}
                                      </span>
                                    )}
                                    {app.rejected_at && (
                                      <span className="flex items-center gap-1 text-gray-500">
                                        Rejected · {new Date(app.rejected_at).toLocaleDateString()}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {(['yes', 'maybe', 'never'] as Rating[]).map((r) => {
                                    const active = app.rating === r;
                                    const styles = RATING_STYLES[r];
                                    return (
                                      <button
                                        key={r}
                                        onClick={() => handleRate(app, r)}
                                        disabled={rateMutation.isPending}
                                        className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${active ? styles.active : styles.idle}`}
                                        title={active ? `Clear ${styles.label} rating` : `Mark as ${styles.label}`}
                                      >
                                        {styles.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="mt-3 flex items-center gap-2 flex-wrap">
                                {app.message && (
                                  <button
                                    onClick={() => setExpandedId(isExpanded ? null : app.id)}
                                    className="text-sm text-gray-500 hover:text-primary flex items-center gap-1"
                                  >
                                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    Message
                                  </button>
                                )}
                                <div className="ml-auto flex items-center gap-2">
                                  {app.status !== 'archived' && app.status !== 'rejected' && (
                                    <Button
                                      size="sm"
                                      icon={<Send className="h-4 w-4" />}
                                      onClick={() => {
                                        setForwardingApp(app);
                                        setForwardLocationId('');
                                      }}
                                    >
                                      Forward
                                    </Button>
                                  )}
                                  {app.status !== 'rejected' && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      icon={<XCircle className="h-4 w-4" />}
                                      onClick={() => handleReject(app)}
                                      loading={rejectMutation.isPending && rejectMutation.variables === app.id}
                                    >
                                      Reject
                                    </Button>
                                  )}
                                  {app.status !== 'archived' && (
                                    <button
                                      onClick={() => archiveMutation.mutate(app.id)}
                                      className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                      title="Archive"
                                    >
                                      <Archive className="h-4 w-4" />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      if (confirm(`Permanently delete the application from ${app.name}?`)) {
                                        deleteMutation.mutate(app.id);
                                      }
                                    }}
                                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                    title="Delete"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                              {isExpanded && app.message && (
                                <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-wrap">
                                  {app.message}
                                </div>
                              )}
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={forwardingApp !== null}
        onClose={() => setForwardingApp(null)}
        title={forwardingApp ? `Forward ${forwardingApp.name} to a shop` : 'Forward'}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Each active manager assigned to the shop you pick will get an <strong>email</strong> from blend556@gmail.com with the applicant's full submission (name, position, phone, email, message).
          </p>
          <Select
            label="Shop"
            options={locationOptions}
            value={forwardLocationId}
            onChange={(e) => setForwardLocationId(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setForwardingApp(null)}>Cancel</Button>
            <Button onClick={submitForward} loading={forwardMutation.isPending} disabled={!forwardLocationId}>
              Send Email
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
