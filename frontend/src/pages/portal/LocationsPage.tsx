import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Edit2, Users, Clock, CalendarDays, AlertTriangle, Copy, ExternalLink, Monitor } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import {
  locations as locationsApi,
  dashboard as dashboardApi,
} from '@/lib/api';
import type { Location, LocationDashboardData } from '@/types';

interface LocationForm {
  name: string;
  address: string;
  phone: string;
  display_name: string;
  hours: string;
  show_on_homepage: boolean;
  is_active: boolean;
}

const defaultForm: LocationForm = {
  name: '',
  address: '',
  phone: '',
  display_name: '',
  hours: '',
  show_on_homepage: false,
  is_active: true,
};

export function LocationsPage() {
  const queryClient = useQueryClient();

  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [form, setForm] = useState<LocationForm>(defaultForm);

  const { data: locationsList, isLoading } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsApi.list,
  });

  // Fetch dashboard data for each location
  const locationIds = (locationsList ?? []).map((l) => l.id);
  const dashboardQueries = useQuery({
    queryKey: ['locationDashboards', locationIds],
    queryFn: async () => {
      if (locationIds.length === 0) return {};
      const results: Record<number, LocationDashboardData> = {};
      await Promise.allSettled(
        locationIds.map(async (id) => {
          try {
            results[id] = await dashboardApi.getLocationData(id);
          } catch {
            // Skip failed location data
          }
        }),
      );
      return results;
    },
    enabled: locationIds.length > 0,
  });

  const dashboardData = dashboardQueries.data ?? {};

  const createMutation = useMutation({
    mutationFn: (data: Partial<Location>) => locationsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      setAddModal(false);
      setForm(defaultForm);
      toast.success('Location created');
    },
    onError: () => toast.error('Failed to create location'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Location> }) =>
      locationsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      setEditModal(false);
      setSelectedLocation(null);
      toast.success('Location updated');
    },
    onError: () => toast.error('Failed to update location'),
  });

  const handleCreate = () => {
    if (!form.name || !form.address) {
      toast.error('Name and address are required');
      return;
    }
    createMutation.mutate({
      name: form.name,
      address: form.address,
      phone: form.phone || undefined,
      display_name: form.display_name || undefined,
      hours: form.hours || undefined,
      show_on_homepage: form.show_on_homepage,
      is_active: form.is_active,
    } as Partial<Location>);
  };

  const handleEdit = () => {
    if (!selectedLocation) return;
    updateMutation.mutate({
      id: selectedLocation.id,
      data: {
        name: form.name,
        address: form.address,
        phone: form.phone || undefined,
        display_name: form.display_name || undefined,
        hours: form.hours || undefined,
        show_on_homepage: form.show_on_homepage,
        is_active: form.is_active,
      } as Partial<Location>,
    });
  };

  const openEditModal = (loc: Location) => {
    setSelectedLocation(loc);
    setForm({
      name: loc.name,
      address: loc.address,
      phone: loc.phone ?? '',
      display_name: loc.display_name ?? '',
      hours: loc.hours ?? '',
      show_on_homepage: loc.show_on_homepage ?? false,
      is_active: loc.is_active,
    });
    setEditModal(true);
  };

  const renderForm = (isEdit: boolean) => (
    <div className="space-y-4">
      <Input
        label="Location Name *"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        placeholder="e.g. Downtown Shop"
      />
      <Input
        label="Address *"
        value={form.address}
        onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
        placeholder="123 Main St, City, State ZIP"
      />
      <Input
        label="Phone"
        type="tel"
        value={form.phone}
        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        placeholder="(555) 123-4567"
      />
      <p className="text-xs text-gray-400">All locations operate on Pacific Time (PST/PDT).</p>

      <div className="border-t border-gray-200 pt-4 space-y-4">
        <p className="text-sm font-semibold text-gray-700">Public homepage</p>
        <Input
          label="Display name"
          value={form.display_name}
          onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
          placeholder="e.g. Apple Valley"
        />
        <Input
          label="Hours"
          value={form.hours}
          onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
          placeholder="Mon-Sat 5:30am-7pm · Sun 6am-7pm"
        />
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="show_on_homepage"
            checked={form.show_on_homepage}
            onChange={(e) => setForm((f) => ({ ...f, show_on_homepage: e.target.checked }))}
            className="h-4 w-4 rounded border-gray-300"
          />
          <label htmlFor="show_on_homepage" className="text-sm text-gray-700">
            Show on public homepage
          </label>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_active"
          checked={form.is_active}
          onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
          className="h-4 w-4 rounded border-gray-300"
        />
        <label htmlFor="is_active" className="text-sm text-gray-700">
          Location is active
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="ghost"
          onClick={() => {
            isEdit ? setEditModal(false) : setAddModal(false);
            setForm(defaultForm);
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={isEdit ? handleEdit : handleCreate}
          loading={isEdit ? updateMutation.isPending : createMutation.isPending}
        >
          {isEdit ? 'Save Changes' : 'Add Location'}
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="lg" label="Loading locations..." />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Locations</h1>
          <p className="page-subtitle">Manage your coffee shop locations.</p>
        </div>
        <Button onClick={() => { setForm(defaultForm); setAddModal(true); }} icon={<Plus className="h-4 w-4" />}>
          Add Location
        </Button>
      </div>

      {locationsList && locationsList.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {locationsList.map((loc) => {
            const dash = dashboardData[loc.id];
            return (
              <Card key={loc.id} className="relative">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-primary" />
                    <h3 className="font-semibold text-gray-900">{loc.name}</h3>
                  </div>
                  <div className="flex items-center gap-1">
                    {loc.is_active ? (
                      <Badge variant="approved">Active</Badge>
                    ) : (
                      <Badge variant="denied">Inactive</Badge>
                    )}
                    <button
                      onClick={() => openEditModal(loc)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      title="Edit"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <p className="text-sm text-gray-500 mb-1">{loc.address}</p>
                {loc.phone && <p className="text-sm text-gray-500 mb-4">{loc.phone}</p>}

                {/* Kiosk URL */}
                {(() => {
                  const kioskUrl = `${window.location.origin}/kiosk?location=${loc.id}`;
                  return (
                    <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs">
                      <Monitor className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                      <code className="flex-1 truncate font-mono text-gray-600" title={kioskUrl}>
                        /kiosk?location={loc.id}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(kioskUrl);
                          toast.success('Kiosk URL copied');
                        }}
                        className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                        title="Copy URL"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <a
                        href={kioskUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                        title="Open kiosk"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  );
                })()}

                {/* Dashboard stats */}
                <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-gray-400" />
                    <div>
                      <p className="text-xs text-gray-500">Employees</p>
                      <p className="text-sm font-semibold">
                        {dash?.clocked_in?.length ?? '--'}
                        <span className="text-gray-400 font-normal"> clocked in</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-gray-400" />
                    <div>
                      <p className="text-xs text-gray-500">Today's Shifts</p>
                      <p className="text-sm font-semibold">
                        {dash?.today_shifts?.length ?? '--'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <div>
                      <p className="text-xs text-gray-500">Pending Requests</p>
                      <p className="text-sm font-semibold">
                        {dash
                          ? (dash.pending_time_off ?? 0) + (dash.pending_swaps ?? 0)
                          : '--'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-gray-400" />
                    <div>
                      <p className="text-xs text-gray-500">Drawer</p>
                      <p className="text-sm font-semibold">
                        {dash?.open_drawer ? (
                          <Badge variant="pending">Open</Badge>
                        ) : (
                          <span className="text-gray-400">Closed</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<MapPin className="h-12 w-12" />}
            title="No Locations"
            description="Add your first coffee shop location to get started."
            action={
              <Button onClick={() => { setForm(defaultForm); setAddModal(true); }} icon={<Plus className="h-4 w-4" />}>
                Add Location
              </Button>
            }
          />
        </Card>
      )}

      {/* Add Location Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Add Location">
        {renderForm(false)}
      </Modal>

      {/* Edit Location Modal */}
      <Modal open={editModal} onClose={() => setEditModal(false)} title="Edit Location">
        {renderForm(true)}
      </Modal>
    </div>
  );
}
