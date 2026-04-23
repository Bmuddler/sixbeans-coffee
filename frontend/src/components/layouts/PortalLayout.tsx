import { useState, useMemo } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Coffee,
  LayoutDashboard,
  Calendar,
  Clock,
  Palmtree,
  ArrowLeftRight,
  MessageSquare,
  FileText,
  DollarSign,
  Users,
  MapPin,
  ClipboardList,
  Settings,
  LogOut,
  Menu,
  X,
  Banknote,
  ShoppingCart,
  Truck,
  BarChart3,
  TrendingUp,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuthStore } from '@/stores/authStore';
import { messages as messagesApi, locations as locationsApi } from '@/lib/api';
import { UserRole } from '@/types';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles?: UserRole[];
}

const navItems: NavItem[] = [
  { to: '/portal/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  {
    to: '/portal/insights',
    label: 'Insights',
    icon: <TrendingUp className="h-5 w-5" />,
    roles: [UserRole.OWNER],
  },
  { to: '/portal/schedule', label: 'Schedule', icon: <Calendar className="h-5 w-5" /> },
  { to: '/portal/time-off', label: 'Time Off', icon: <Palmtree className="h-5 w-5" /> },
  { to: '/portal/shift-swaps', label: 'Shift Swaps', icon: <ArrowLeftRight className="h-5 w-5" /> },
  { to: '/portal/messages', label: 'Messages', icon: <MessageSquare className="h-5 w-5" /> },
  { to: '/portal/documents', label: 'Documents', icon: <FileText className="h-5 w-5" /> },
  { to: '/portal/time-clock', label: 'Time Clock', icon: <Clock className="h-5 w-5" /> },
  {
    to: '/portal/cash-drawer',
    label: 'Cash Drawer',
    icon: <Banknote className="h-5 w-5" />,
    roles: [UserRole.MANAGER, UserRole.OWNER],
  },
  {
    to: '/portal/supply-orders',
    label: 'Order Supplies',
    icon: <ShoppingCart className="h-5 w-5" />,
    roles: [UserRole.MANAGER, UserRole.OWNER],
  },
  {
    to: '/portal/usfoods',
    label: 'US Foods',
    icon: <Truck className="h-5 w-5" />,
    roles: [UserRole.OWNER],
  },
  {
    to: '/portal/admin/analytics',
    label: 'Analytics Setup',
    icon: <BarChart3 className="h-5 w-5" />,
    roles: [UserRole.OWNER],
  },
  {
    to: '/portal/admin/expenses',
    label: 'Expenses',
    icon: <DollarSign className="h-5 w-5" />,
    roles: [UserRole.OWNER],
  },
  {
    to: '/portal/payroll',
    label: 'Payroll',
    icon: <DollarSign className="h-5 w-5" />,
    roles: [UserRole.OWNER],
  },
  {
    to: '/portal/employees',
    label: 'Employees',
    icon: <Users className="h-5 w-5" />,
    roles: [UserRole.MANAGER, UserRole.OWNER],
  },
  {
    to: '/portal/locations',
    label: 'Locations',
    icon: <MapPin className="h-5 w-5" />,
    roles: [UserRole.OWNER],
  },
  {
    to: '/portal/audit-log',
    label: 'Audit Log',
    icon: <ClipboardList className="h-5 w-5" />,
    roles: [UserRole.OWNER],
  },
  { to: '/portal/settings', label: 'Settings', icon: <Settings className="h-5 w-5" /> },
];

export function PortalLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const { data: unreadData } = useQuery({
    queryKey: ['unread-count'],
    queryFn: messagesApi.getUnreadCount,
    refetchInterval: 15000,
  });
  const unreadCount = unreadData?.unread_count ?? 0;

  const { data: allLocations } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsApi.list,
  });

  const myLocationName = useMemo(() => {
    if (!allLocations || !user?.location_ids?.length) return null;
    const names = allLocations
      .filter((l) => user.location_ids!.includes(l.id))
      .map((l) => l.name.replace('Six Beans - ', ''));
    return names.length > 0 ? names.join(' · ') : null;
  }, [allLocations, user?.location_ids]);

  const filteredNavItems = navItems.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role)),
  );

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className="flex items-center justify-center px-4 py-4 border-b border-primary-600">
        <img src="/logo.png" alt="Six Beans" className="h-10 w-auto rounded" />
      </div>

      {/* User Info */}
      <div className="px-4 py-4 border-b border-primary-600">
        <p className="text-sm font-medium text-white truncate">
          {user?.first_name} {user?.last_name}
        </p>
        <p className="text-xs text-primary-200 capitalize">{user?.role}</p>
        {myLocationName && (
          <p className="text-[10px] text-primary-300 mt-1 flex items-center gap-1 truncate">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            {myLocationName}
          </p>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {filteredNavItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-600 text-white'
                      : 'text-primary-100 hover:bg-primary-600/50 hover:text-white',
                  )
                }
              >
                {item.icon}
                {item.label}
                {item.to === '/portal/messages' && unreadCount > 0 && (
                  <span className="ml-auto inline-flex items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-medium text-white min-w-[20px]">
                    {unreadCount}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Logout */}
      <div className="border-t border-primary-600 px-3 py-4">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-primary-100 hover:bg-primary-600/50 hover:text-white transition-colors"
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - mobile */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-primary-700 transition-transform lg:hidden',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute right-2 top-4 rounded-lg p-1 text-primary-200 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
        <SidebarContent />
      </aside>

      {/* Sidebar - desktop */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-primary-700">
        <SidebarContent />
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col lg:pl-64">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
          >
            <Menu className="h-6 w-6" />
          </button>
          <img src="/logo.png" alt="Six Beans" className="h-8 w-auto" />
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
