import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Send, Archive, Trash2, Mail, Phone, MapPin, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { applications, locations as locationsApi } from '@/lib/api';

interface JobApp {
  id: number;
  name: string;
  email: string;
  phone: string;
  position: string;
  location: string;
  message: string | null;
  created_at: string;
  status: 'new' | 'forwarded' | 'archived';
  forwarded_to_location_id: number | null;
  forwarded_to_location_name: string | null;
  forwarded_at: string | null;
}

interface LocationRow {
  id: number;
  name: string;
}

function statusBadge(status: JobApp['status']) {
  if (status === 'forwarded') return <Badge variant="approved">Forwarded</Badge>;
  if (status === 'archived') return <Badge variant="denied">Archived</Badge>;
  return <Badge variant="pending">New</Badge>;
}

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
      toast.success('Forwarded to location managers via SMS');
      setForwardingApp(null);
      setForwardLocationId('');
    },
    onError: (err: any) => toast.error(extractError(err, 'Failed to forward')),
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

  const submitForward = () => {
    if (!forwardingApp || !forwardLocationId) {
      toast.error('Pick a shop first');
      return;
    }
    forwardMutation.mutate({ id: forwardingApp.id, locationId: Number(forwardLocationId) });
  };

  const list = apps ?? [];
  const newCount = list.filter((a) => a.status === 'new').length;

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
              {showArchived ? 'No applications yet.' : 'No new applications. Check archived for older ones.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((app) => {
            const isExpanded = expandedId === app.id;
            return (
              <Card key={app.id} className="!p-0 overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-base font-semibold text-gray-900">{app.name}</p>
                        {statusBadge(app.status)}
                        <span className="text-xs text-gray-400">
                          {new Date(app.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        <strong>{app.position}</strong> · Applied for {app.location}
                      </p>
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
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {app.message && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : app.id)}
                          className="text-sm text-gray-500 hover:text-primary flex items-center gap-1"
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          Message
                        </button>
                      )}
                      {app.status !== 'archived' && (
                        <>
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
                          <button
                            onClick={() => archiveMutation.mutate(app.id)}
                            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            title="Archive"
                          >
                            <Archive className="h-4 w-4" />
                          </button>
                        </>
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
      )}

      <Modal
        open={forwardingApp !== null}
        onClose={() => setForwardingApp(null)}
        title={forwardingApp ? `Forward ${forwardingApp.name} to a shop` : 'Forward'}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Each active manager assigned to the shop you pick will get an SMS with the applicant's name, position, phone, and email.
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
              Send SMS
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
