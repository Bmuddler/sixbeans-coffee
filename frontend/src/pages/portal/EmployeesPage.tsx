import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Users,
  Plus,
  Search,
  Edit2,
  UserX,
  UserCheck,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { useAuthStore } from '@/stores/authStore';
import { users as usersApi, locations as locationsApi } from '@/lib/api';
import type { User } from '@/types';
import { UserRole } from '@/types';

const ROLE_OPTIONS = [
  { value: '', label: 'All Roles' },
  { value: UserRole.EMPLOYEE, label: 'Employee' },
  { value: UserRole.MANAGER, label: 'Manager' },
  { value: UserRole.OWNER, label: 'Owner' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

interface EmployeeForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: UserRole;
  primary_location_id: number;
  secondary_location_ids: number[];
  pin_code: string;
  password: string;
  hourly_rate: string;
  hire_date: string;
}

const defaultForm: EmployeeForm = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  role: UserRole.EMPLOYEE,
  primary_location_id: 0,
  secondary_location_ids: [],
  pin_code: '',
  password: '',
  hourly_rate: '',
  hire_date: format(new Date(), 'yyyy-MM-dd'),
};

export function EmployeesPage() {
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const isOwner = currentUser?.role === UserRole.OWNER;

  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [detailModal, setDetailModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<User | null>(null);
  const [form, setForm] = useState<EmployeeForm>(defaultForm);

  const { data: locationsList } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsApi.list,
  });

  const locationOptions = (locationsList ?? []).map((loc) => ({
    value: loc.id,
    label: loc.name,
  }));

  const { data: employeesData, isLoading } = useQuery({
    queryKey: ['employees', page, roleFilter, locationFilter],
    queryFn: () =>
      usersApi.list({
        page,
        per_page: 20,
        role: roleFilter || undefined,
        location_id: isOwner ? (locationFilter || undefined) : currentUser?.primary_location_id,
      }),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<User> & { password: string }) => usersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setAddModal(false);
      setForm(defaultForm);
      toast.success('Employee created');
    },
    onError: () => toast.error('Failed to create employee'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<User> }) => usersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setEditModal(false);
      setSelectedEmployee(null);
      toast.success('Employee updated');
    },
    onError: () => toast.error('Failed to update employee'),
  });

  const handleCreate = () => {
    if (!form.first_name || !form.last_name || !form.email || !form.password) {
      toast.error('Fill in all required fields');
      return;
    }
    createMutation.mutate({
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      phone: form.phone || undefined,
      role: form.role,
      primary_location_id: form.primary_location_id || (locationsList?.[0]?.id ?? 1),
      secondary_location_ids: form.secondary_location_ids,
      pin_code: form.pin_code || undefined,
      password: form.password,
      hourly_rate: parseFloat(form.hourly_rate) || 0,
      hire_date: form.hire_date,
      is_active: true,
    });
  };

  const handleEdit = () => {
    if (!selectedEmployee) return;
    updateMutation.mutate({
      id: selectedEmployee.id,
      data: {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: form.phone || undefined,
        role: form.role,
        primary_location_id: form.primary_location_id,
        secondary_location_ids: form.secondary_location_ids,
        pin_code: form.pin_code || undefined,
        hourly_rate: parseFloat(form.hourly_rate) || undefined,
      },
    });
  };

  const handleToggleActive = (emp: User) => {
    updateMutation.mutate({
      id: emp.id,
      data: { is_active: !emp.is_active },
    });
  };

  const openEditModal = (emp: User) => {
    setSelectedEmployee(emp);
    setForm({
      first_name: emp.first_name,
      last_name: emp.last_name,
      email: emp.email,
      phone: emp.phone ?? '',
      role: emp.role,
      primary_location_id: emp.primary_location_id,
      secondary_location_ids: emp.secondary_location_ids,
      pin_code: emp.pin_code ?? '',
      password: '',
      hourly_rate: emp.hourly_rate.toString(),
      hire_date: emp.hire_date,
    });
    setEditModal(true);
  };

  const openDetailModal = (emp: User) => {
    setSelectedEmployee(emp);
    setDetailModal(true);
  };

  const toggleSecondaryLocation = (locId: number) => {
    setForm((prev) => ({
      ...prev,
      secondary_location_ids: prev.secondary_location_ids.includes(locId)
        ? prev.secondary_location_ids.filter((id) => id !== locId)
        : [...prev.secondary_location_ids, locId],
    }));
  };

  // Filter by search term client-side
  const employees = (employeesData?.items ?? []).filter((emp) => {
    if (statusFilter === 'active' && !emp.is_active) return false;
    if (statusFilter === 'inactive' && emp.is_active) return false;
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      emp.first_name.toLowerCase().includes(term) ||
      emp.last_name.toLowerCase().includes(term) ||
      emp.email.toLowerCase().includes(term)
    );
  });

  const columns: Column<User & Record<string, unknown>>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row) => (
        <button
          className="text-primary hover:underline font-medium"
          onClick={() => openDetailModal(row as unknown as User)}
        >
          {row.first_name} {row.last_name}
        </button>
      ),
    },
    { key: 'email', header: 'Email', sortable: true },
    {
      key: 'role',
      header: 'Role',
      render: (row) => (
        <Badge variant="info">
          {(row.role as string).charAt(0).toUpperCase() + (row.role as string).slice(1)}
        </Badge>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      render: (row) => {
        const loc = locationsList?.find((l) => l.id === row.primary_location_id);
        return loc?.name ?? `Location #${row.primary_location_id}`;
      },
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) =>
        row.is_active ? (
          <Badge variant="approved">Active</Badge>
        ) : (
          <Badge variant="denied">Inactive</Badge>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openEditModal(row as unknown as User)}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            title="Edit"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleToggleActive(row as unknown as User)}
            className={`rounded p-1 hover:bg-gray-100 ${
              row.is_active ? 'text-red-500 hover:text-red-700' : 'text-green-500 hover:text-green-700'
            }`}
            title={row.is_active ? 'Deactivate' : 'Reactivate'}
          >
            {row.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
          </button>
        </div>
      ),
    },
  ];

  const renderForm = (isEdit: boolean) => (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="First Name *"
          value={form.first_name}
          onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
        />
        <Input
          label="Last Name *"
          value={form.last_name}
          onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
        />
      </div>
      <Input
        label="Email *"
        type="email"
        value={form.email}
        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Phone"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />
        <Input
          label="Hourly Rate ($)"
          type="number"
          step="0.01"
          value={form.hourly_rate}
          onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))}
        />
      </div>
      {!isEdit && (
        <Input
          label="Password *"
          type="password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Role"
          options={[
            { value: UserRole.EMPLOYEE, label: 'Employee' },
            { value: UserRole.MANAGER, label: 'Manager' },
            ...(isOwner ? [{ value: UserRole.OWNER, label: 'Owner' }] : []),
          ]}
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
        />
        <Select
          label="Primary Location"
          options={locationOptions}
          value={form.primary_location_id}
          onChange={(e) => setForm((f) => ({ ...f, primary_location_id: Number(e.target.value) }))}
        />
      </div>
      <Input
        label="PIN Code"
        type="text"
        maxLength={6}
        value={form.pin_code}
        onChange={(e) => setForm((f) => ({ ...f, pin_code: e.target.value }))}
        helperText="Used for kiosk clock-in"
      />
      <Input
        label="Hire Date"
        type="date"
        value={form.hire_date}
        onChange={(e) => setForm((f) => ({ ...f, hire_date: e.target.value }))}
      />

      {/* Multi-location assignment */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-gray-700">Secondary Locations</p>
        <div className="flex flex-wrap gap-2">
          {locationOptions
            .filter((loc) => loc.value !== form.primary_location_id)
            .map((loc) => {
              const selected = form.secondary_location_ids.includes(loc.value as number);
              return (
                <button
                  key={loc.value}
                  type="button"
                  onClick={() => toggleSecondaryLocation(loc.value as number)}
                  className={`rounded-full px-3 py-1 text-sm border transition-colors ${
                    selected
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-primary'
                  }`}
                >
                  {loc.label}
                </button>
              );
            })}
        </div>
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
          {isEdit ? 'Save Changes' : 'Add Employee'}
        </Button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Employees</h1>
          <p className="page-subtitle">Manage employee accounts and information.</p>
        </div>
        <Button onClick={() => { setForm(defaultForm); setAddModal(true); }} icon={<Plus className="h-4 w-4" />}>
          Add Employee
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <Input
              placeholder="Search employees..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              icon={<Search className="h-4 w-4" />}
            />
          </div>
          <Select
            options={ROLE_OPTIONS}
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
            className="w-36"
          />
          {isOwner && (
            <Select
              options={[{ value: 0, label: 'All Locations' }, ...locationOptions]}
              value={locationFilter}
              onChange={(e) => { setLocationFilter(Number(e.target.value)); setPage(1); }}
              className="w-44"
            />
          )}
          <Select
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-36"
          />
        </div>
      </Card>

      {/* Employee Table */}
      <Card padding={false}>
        {isLoading ? (
          <LoadingSpinner label="Loading employees..." className="py-12" />
        ) : employees.length > 0 ? (
          <DataTable
            columns={columns}
            data={employees as (User & Record<string, unknown>)[]}
            keyExtractor={(row) => row.id}
            pagination={
              employeesData
                ? {
                    page: employeesData.page,
                    totalPages: employeesData.total_pages,
                    onPageChange: setPage,
                  }
                : undefined
            }
          />
        ) : (
          <EmptyState
            icon={<Users className="h-12 w-12" />}
            title="No Employees Found"
            description="No employees match your current filters."
            action={
              <Button onClick={() => { setForm(defaultForm); setAddModal(true); }} icon={<Plus className="h-4 w-4" />}>
                Add Employee
              </Button>
            }
          />
        )}
      </Card>

      {/* Add Employee Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Add Employee" size="lg">
        {renderForm(false)}
      </Modal>

      {/* Edit Employee Modal */}
      <Modal open={editModal} onClose={() => setEditModal(false)} title="Edit Employee" size="lg">
        {renderForm(true)}
      </Modal>

      {/* Employee Detail Modal */}
      <Modal
        open={detailModal}
        onClose={() => { setDetailModal(false); setSelectedEmployee(null); }}
        title={selectedEmployee ? `${selectedEmployee.first_name} ${selectedEmployee.last_name}` : 'Employee Details'}
        size="lg"
      >
        {selectedEmployee && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-gray-500">Email</p>
                <p className="text-sm font-medium">{selectedEmployee.email}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Phone</p>
                <p className="text-sm font-medium">{selectedEmployee.phone ?? '--'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Role</p>
                <Badge variant="info">
                  {selectedEmployee.role.charAt(0).toUpperCase() + selectedEmployee.role.slice(1)}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-gray-500">Status</p>
                {selectedEmployee.is_active ? (
                  <Badge variant="approved">Active</Badge>
                ) : (
                  <Badge variant="denied">Inactive</Badge>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-500">Primary Location</p>
                <p className="text-sm font-medium">
                  {locationsList?.find((l) => l.id === selectedEmployee.primary_location_id)?.name ??
                    `Location #${selectedEmployee.primary_location_id}`}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Secondary Locations</p>
                <p className="text-sm font-medium">
                  {selectedEmployee.secondary_location_ids.length > 0
                    ? selectedEmployee.secondary_location_ids
                        .map((id) => locationsList?.find((l) => l.id === id)?.name ?? `#${id}`)
                        .join(', ')
                    : 'None'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Hire Date</p>
                <p className="text-sm font-medium">
                  {format(new Date(selectedEmployee.hire_date), 'MMM d, yyyy')}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Hourly Rate</p>
                <p className="text-sm font-medium">${selectedEmployee.hourly_rate.toFixed(2)}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => { setDetailModal(false); setSelectedEmployee(null); }}
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  setDetailModal(false);
                  openEditModal(selectedEmployee);
                }}
                icon={<Edit2 className="h-4 w-4" />}
              >
                Edit
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
