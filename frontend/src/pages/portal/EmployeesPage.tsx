import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Plus,
  Search,
  Edit2,
  UserX,
  UserCheck,
  CheckSquare,
  Square,
  MapPin,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { useAuthStore } from '@/stores/authStore';
import { users as usersApi, locations as locationsApi } from '@/lib/api';
import type { User, Location } from '@/types';
import { UserRole } from '@/types';

const ROLE_OPTIONS = [
  { value: '', label: 'All Roles' },
  { value: UserRole.EMPLOYEE, label: 'Employee' },
  { value: UserRole.MANAGER, label: 'Manager' },
  { value: UserRole.OWNER, label: 'Owner' },
];

interface EmployeeForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: UserRole;
  location_ids: number[];
  pin_last_four: string;
  password: string;
}

const defaultForm: EmployeeForm = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  role: UserRole.EMPLOYEE,
  location_ids: [],
  pin_last_four: '',
  password: '',
};

export function EmployeesPage() {
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const isOwner = currentUser?.role === UserRole.OWNER;

  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [collapsedLocations, setCollapsedLocations] = useState<Set<number>>(new Set());
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<User | null>(null);
  const [form, setForm] = useState<EmployeeForm>(defaultForm);

  const { data: locationsList } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsApi.list,
  });

  const { data: employeesData, isLoading } = useQuery({
    queryKey: ['employees-all'],
    queryFn: () => usersApi.list({ per_page: 100 }),
  });

  const extractError = (err: any, fallback: string): string => {
    const detail = err?.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      const loc = Array.isArray(first?.loc) ? first.loc.join('.') : '';
      const msg = first?.msg ?? 'invalid input';
      return loc ? `${loc}: ${msg}` : msg;
    }
    return err?.message ?? fallback;
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => usersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees-all'] });
      setAddModal(false);
      setForm(defaultForm);
      toast.success('Employee created');
    },
    onError: (err: any) => toast.error(extractError(err, 'Failed to create employee')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<User> }) => usersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees-all'] });
      setEditModal(false);
      setSelectedEmployee(null);
      toast.success('Employee updated');
    },
    onError: (err: any) => toast.error(extractError(err, 'Failed to update employee')),
  });

  const allEmployees = useMemo(() => {
    let list = employeesData?.items ?? [];
    if (!showInactive) list = list.filter((e) => e.is_active);
    if (roleFilter) list = list.filter((e) => e.role === roleFilter);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (e) =>
          e.first_name.toLowerCase().includes(term) ||
          e.last_name.toLowerCase().includes(term) ||
          e.email?.toLowerCase().includes(term),
      );
    }
    return list;
  }, [employeesData, roleFilter, searchTerm, showInactive]);

  const inactiveCount = useMemo(
    () => (employeesData?.items ?? []).filter((e) => !e.is_active).length,
    [employeesData],
  );

  // Group employees by location
  const employeesByLocation = useMemo(() => {
    const map = new Map<number, { location: Location; employees: User[] }>();
    const unassigned: User[] = [];

    locationsList?.forEach((loc) => {
      map.set(loc.id, { location: loc, employees: [] });
    });

    allEmployees.forEach((emp) => {
      const locIds = emp.location_ids ?? [];
      if (locIds.length === 0) {
        unassigned.push(emp);
      } else {
        locIds.forEach((locId) => {
          const group = map.get(locId);
          if (group && !group.employees.find((e) => e.id === emp.id)) {
            group.employees.push(emp);
          }
        });
      }
    });

    return { byLocation: map, unassigned };
  }, [allEmployees, locationsList]);

  // Selection helpers
  const toggleEmployee = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectLocation = (locId: number) => {
    const group = employeesByLocation.byLocation.get(locId);
    if (!group) return;
    const locEmpIds = group.employees.map((e) => e.id);
    const allSelected = locEmpIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        locEmpIds.forEach((id) => next.delete(id));
      } else {
        locEmpIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const selectAll = () => {
    const allIds = allEmployees.map((e) => e.id);
    const allSelected = allIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  };

  const toggleCollapse = (locId: number) => {
    setCollapsedLocations((prev) => {
      const next = new Set(prev);
      if (next.has(locId)) next.delete(locId);
      else next.add(locId);
      return next;
    });
  };

  const handleCreate = () => {
    if (!form.first_name || !form.email || !form.password) {
      toast.error('Fill in required fields (name, email, password)');
      return;
    }
    createMutation.mutate({
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      phone: form.phone || undefined,
      role: form.role,
      location_ids: form.location_ids,
      pin_last_four: form.pin_last_four || undefined,
      password: form.password,
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
        location_ids: form.location_ids,
        pin_last_four: form.pin_last_four || undefined,
      },
    });
  };

  const handleToggleActive = (emp: User) => {
    updateMutation.mutate({ id: emp.id, data: { is_active: !emp.is_active } });
  };

  const openEditModal = (emp: User) => {
    setSelectedEmployee(emp);
    setForm({
      first_name: emp.first_name,
      last_name: emp.last_name,
      email: emp.email,
      phone: emp.phone ?? '',
      role: emp.role,
      location_ids: emp.location_ids ?? [],
      pin_last_four: emp.pin_last_four ?? '',
      password: '',
    });
    setEditModal(true);
  };

  const toggleFormLocation = (locId: number) => {
    setForm((prev) => ({
      ...prev,
      location_ids: prev.location_ids.includes(locId)
        ? prev.location_ids.filter((id) => id !== locId)
        : [...prev.location_ids, locId],
    }));
  };

  const locationOptions = locationsList?.map((loc) => ({ value: loc.id, label: loc.name })) ?? [];

  const renderEmployeeRow = (emp: User) => {
    const isSelected = selectedIds.has(emp.id);
    return (
      <div
        key={emp.id}
        className={`flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors ${
          isSelected ? 'bg-primary/5' : ''
        }`}
      >
        <button onClick={() => toggleEmployee(emp.id)} className="text-gray-400 hover:text-primary">
          {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {emp.first_name} {emp.last_name}
          </p>
          <p className="text-xs text-gray-500 truncate">{emp.email}</p>
        </div>
        <Badge variant={emp.role === 'owner' ? 'info' : emp.role === 'manager' ? 'pending' : 'approved'}>
          {emp.role.charAt(0).toUpperCase() + emp.role.slice(1)}
        </Badge>
        {!emp.is_active && <Badge variant="denied">Inactive</Badge>}
        <div className="flex items-center gap-1">
          <button onClick={() => openEditModal(emp)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Edit">
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => handleToggleActive(emp)}
            className={`rounded p-1 hover:bg-gray-100 ${emp.is_active ? 'text-gray-400 hover:text-red-600' : 'text-gray-400 hover:text-green-600'}`}
            title={emp.is_active ? 'Deactivate' : 'Reactivate'}
          >
            {emp.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    );
  };

  const renderForm = (isEdit: boolean) => (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="First Name *" value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
        <Input label="Last Name" value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
      </div>
      <Input label="Email *" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Phone" type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        <Input label="PIN (last 4)" type="text" maxLength={4} value={form.pin_last_four} onChange={(e) => setForm((f) => ({ ...f, pin_last_four: e.target.value }))} helperText="For kiosk clock-in" />
      </div>
      {!isEdit && (
        <Input label="Password *" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
      )}
      <Select
        label="Role"
        options={
          isOwner
            ? [
                { value: UserRole.EMPLOYEE, label: 'Employee' },
                { value: UserRole.MANAGER, label: 'Manager' },
                { value: UserRole.OWNER, label: 'Owner' },
              ]
            : [{ value: UserRole.EMPLOYEE, label: 'Employee' }]
        }
        value={form.role}
        onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
        helperText={isOwner ? undefined : 'Managers can only create employee accounts.'}
      />
      <div>
        <p className="mb-2 text-sm font-medium text-gray-700">Locations</p>
        <div className="flex flex-wrap gap-2">
          {locationOptions.map((loc) => {
            const selected = form.location_ids.includes(loc.value as number);
            return (
              <button
                key={loc.value}
                type="button"
                onClick={() => toggleFormLocation(loc.value as number)}
                className={`rounded-lg px-3 py-1.5 text-sm border transition-colors ${
                  selected ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-300 hover:border-primary'
                }`}
              >
                {loc.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={() => { isEdit ? setEditModal(false) : setAddModal(false); setForm(defaultForm); }}>Cancel</Button>
        <Button onClick={isEdit ? handleEdit : handleCreate} loading={isEdit ? updateMutation.isPending : createMutation.isPending}>
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
          <p className="page-subtitle">
            {allEmployees.length} employees{selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
              Clear Selection
            </Button>
          )}
          <Button onClick={() => { setForm(defaultForm); setAddModal(true); }} icon={<Plus className="h-4 w-4" />}>
            Add Employee
          </Button>
        </div>
      </div>

      {/* Filters & Select All */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <Input placeholder="Search employees..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} icon={<Search className="h-4 w-4" />} />
          </div>
          <Select options={ROLE_OPTIONS} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="w-36" />
          <Button
            variant={showInactive ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setShowInactive((v) => !v)}
            title={showInactive ? 'Hide deactivated employees' : 'Show deactivated employees'}
          >
            {showInactive ? 'Hide inactive' : `Show inactive${inactiveCount > 0 ? ` (${inactiveCount})` : ''}`}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={selectAll}
            icon={allEmployees.length > 0 && allEmployees.every((e) => selectedIds.has(e.id)) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          >
            Select All
          </Button>
        </div>
      </Card>

      {/* Employees grouped by location */}
      {isLoading ? (
        <LoadingSpinner label="Loading employees..." className="py-12" />
      ) : allEmployees.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-12 w-12" />}
            title="No Employees Found"
            description="No employees match your current filters."
            action={<Button onClick={() => { setForm(defaultForm); setAddModal(true); }} icon={<Plus className="h-4 w-4" />}>Add Employee</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {Array.from(employeesByLocation.byLocation.entries()).map(([locId, { location, employees: locEmps }]) => {
            if (locEmps.length === 0) return null;
            const isCollapsed = collapsedLocations.has(locId);
            const allLocSelected = locEmps.every((e) => selectedIds.has(e.id));
            const someLocSelected = locEmps.some((e) => selectedIds.has(e.id));

            return (
              <Card key={locId} padding={false}>
                <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <button onClick={() => selectLocation(locId)} className="text-gray-400 hover:text-primary">
                    {allLocSelected ? (
                      <CheckSquare className="h-4 w-4 text-primary" />
                    ) : someLocSelected ? (
                      <CheckSquare className="h-4 w-4 text-primary/50" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                  <button onClick={() => toggleCollapse(locId)} className="flex items-center gap-2 flex-1">
                    {isCollapsed ? <ChevronRight className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                    <MapPin className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-gray-900">{location.name}</span>
                    <Badge variant="info">{locEmps.length}</Badge>
                  </button>
                </div>
                {!isCollapsed && (
                  <div>
                    {locEmps.map(renderEmployeeRow)}
                  </div>
                )}
              </Card>
            );
          })}

          {/* Unassigned employees */}
          {employeesByLocation.unassigned.length > 0 && (
            <Card padding={false}>
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
                <MapPin className="h-4 w-4 text-gray-400" />
                <span className="font-semibold text-gray-900">No Location Assigned</span>
                <Badge variant="pending">{employeesByLocation.unassigned.length}</Badge>
              </div>
              <div>
                {employeesByLocation.unassigned.map(renderEmployeeRow)}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Add Employee Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Add Employee" size="lg">
        {renderForm(false)}
      </Modal>

      {/* Edit Employee Modal */}
      <Modal open={editModal} onClose={() => setEditModal(false)} title="Edit Employee" size="lg">
        {renderForm(true)}
      </Modal>
    </div>
  );
}
