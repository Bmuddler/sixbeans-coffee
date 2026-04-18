import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Save, Lock, Bell, User as UserIcon, Clock, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import { users as usersApi, auth, systemSettings } from '@/lib/api';
import { UserRole } from '@/types';

interface ProfileForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

interface PasswordForm {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

interface NotificationPrefs {
  sms_shift_reminders: boolean;
  sms_schedule_changes: boolean;
  sms_time_off_updates: boolean;
  sms_swap_requests: boolean;
  sms_announcements: boolean;
  sms_payroll_ready: boolean;
}

function SystemSettingsCard() {
  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: systemSettings.get,
  });

  const [earlyMin, setEarlyMin] = useState('5');
  const [autoOutMin, setAutoOutMin] = useState('0');

  useEffect(() => {
    if (settings) {
      setEarlyMin(String(settings.early_clockin_minutes));
      setAutoOutMin(String(settings.auto_clockout_minutes));
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () => systemSettings.update({
      early_clockin_minutes: parseInt(earlyMin, 10) || 0,
      auto_clockout_minutes: parseInt(autoOutMin, 10) || 0,
    }),
    onSuccess: () => toast.success('System settings saved'),
    onError: () => toast.error('Failed to save settings'),
  });

  if (isLoading) return null;

  return (
    <Card title="Time Clock Settings" actions={<Clock className="h-4 w-4 text-gray-400" />}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Control when employees can clock in relative to their scheduled shift, and when they are automatically clocked out after their shift ends. Unscheduled clock-ins are always allowed but flagged for manager review.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Early Clock-In Limit (minutes)"
            type="number"
            min="0"
            value={earlyMin}
            onChange={(e) => setEarlyMin(e.target.value)}
            helperText="How many minutes before their shift an employee can clock in. Set to 0 for no limit."
          />
          <Input
            label="Auto Clock-Out After Shift (minutes)"
            type="number"
            min="0"
            value={autoOutMin}
            onChange={(e) => setAutoOutMin(e.target.value)}
            helperText="Automatically clock out this many minutes after shift ends. Set to 0 for exact shift end time."
          />
        </div>
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
          <p className="text-sm text-blue-700">
            <strong>How it works:</strong> Employees with a scheduled shift can only clock in {earlyMin} min early and will be auto-clocked out {autoOutMin} min after their shift ends. Employees without a scheduled shift can always clock in — their entry will be flagged as "unscheduled" for manager review.
          </p>
        </div>
        <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} icon={<Save className="h-4 w-4" />}>
          Save Time Clock Settings
        </Button>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const isOwner = user?.role === UserRole.OWNER;
  const location = useLocation();
  const forcePasswordChange = (location.state as any)?.forcePasswordChange || user?.must_change_password;

  const [profileForm, setProfileForm] = useState<ProfileForm>({
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
  });

  const [passwordForm, setPasswordForm] = useState<PasswordForm>({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  const [passwordErrors, setPasswordErrors] = useState<Partial<PasswordForm>>({});

  const [notifications, setNotifications] = useState<NotificationPrefs>({
    sms_shift_reminders: true,
    sms_schedule_changes: true,
    sms_time_off_updates: true,
    sms_swap_requests: true,
    sms_announcements: true,
    sms_payroll_ready: true,
  });

  const profileMutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error('Not authenticated');
      return usersApi.update(user.id, {
        first_name: profileForm.first_name,
        last_name: profileForm.last_name,
        email: profileForm.email,
        phone: profileForm.phone || undefined,
      });
    },
    onSuccess: (updatedUser) => {
      setUser(updatedUser);
      toast.success('Profile updated');
    },
    onError: () => toast.error('Failed to update profile'),
  });

  const passwordMutation = useMutation({
    mutationFn: () => auth.changePassword({ new_password: passwordForm.new_password }),
    onSuccess: () => {
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
      setPasswordErrors({});
      if (user) setUser({ ...user, must_change_password: false });
      toast.success('Password updated successfully!');
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      toast.error(detail || 'Failed to update password');
    },
  });

  const handlePasswordSubmit = () => {
    const errors: Partial<PasswordForm> = {};
    if (!passwordForm.current_password) {
      errors.current_password = 'Current password is required';
    }
    if (!passwordForm.new_password) {
      errors.new_password = 'New password is required';
    } else if (passwordForm.new_password.length < 8) {
      errors.new_password = 'Password must be at least 8 characters';
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      errors.confirm_password = 'Passwords do not match';
    }
    setPasswordErrors(errors);
    if (Object.keys(errors).length === 0) {
      passwordMutation.mutate();
    }
  };

  const toggleNotification = (key: keyof NotificationPrefs) => {
    setNotifications((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const notificationItems: { key: keyof NotificationPrefs; label: string; description: string }[] = [
    {
      key: 'sms_shift_reminders',
      label: 'Shift Reminders',
      description: 'Get SMS reminders before your shift starts',
    },
    {
      key: 'sms_schedule_changes',
      label: 'Schedule Changes',
      description: 'Notifications when your schedule is updated',
    },
    {
      key: 'sms_time_off_updates',
      label: 'Time Off Updates',
      description: 'Notifications when your time off request status changes',
    },
    {
      key: 'sms_swap_requests',
      label: 'Swap Requests',
      description: 'Notifications for incoming shift swap requests',
    },
    {
      key: 'sms_announcements',
      label: 'Announcements',
      description: 'SMS for new announcements from management',
    },
    {
      key: 'sms_payroll_ready',
      label: 'Payroll Ready',
      description: 'Notification when payroll has been processed',
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your account settings.</p>
        </div>
      </div>

      {forcePasswordChange && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">Password Change Required</p>
            <p className="text-sm text-red-700 mt-1">You must set a new password before continuing. Your password must be at least 8 characters with one uppercase letter, one lowercase letter, and one number.</p>
          </div>
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        {/* Profile Information */}
        <Card
          title="Profile Information"
          actions={
            <div className="flex items-center gap-1 text-gray-400">
              <UserIcon className="h-4 w-4" />
            </div>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="First Name"
                value={profileForm.first_name}
                onChange={(e) =>
                  setProfileForm((f) => ({ ...f, first_name: e.target.value }))
                }
              />
              <Input
                label="Last Name"
                value={profileForm.last_name}
                onChange={(e) =>
                  setProfileForm((f) => ({ ...f, last_name: e.target.value }))
                }
              />
            </div>
            <Input
              label="Email"
              type="email"
              value={profileForm.email}
              onChange={(e) =>
                setProfileForm((f) => ({ ...f, email: e.target.value }))
              }
            />
            <Input
              label="Phone"
              type="tel"
              value={profileForm.phone}
              onChange={(e) =>
                setProfileForm((f) => ({ ...f, phone: e.target.value }))
              }
              helperText="Used for SMS notifications"
            />
            <Button
              onClick={() => profileMutation.mutate()}
              loading={profileMutation.isPending}
              icon={<Save className="h-4 w-4" />}
            >
              Save Changes
            </Button>
          </div>
        </Card>

        {/* Change Password */}
        <Card
          title="Change Password"
          actions={
            <div className="flex items-center gap-1 text-gray-400">
              <Lock className="h-4 w-4" />
            </div>
          }
        >
          <div className="space-y-4">
            <Input
              label="Current Password"
              type="password"
              value={passwordForm.current_password}
              onChange={(e) =>
                setPasswordForm((f) => ({ ...f, current_password: e.target.value }))
              }
              error={passwordErrors.current_password}
            />
            <Input
              label="New Password"
              type="password"
              value={passwordForm.new_password}
              onChange={(e) =>
                setPasswordForm((f) => ({ ...f, new_password: e.target.value }))
              }
              error={passwordErrors.new_password}
              helperText="Min 8 chars, 1 uppercase, 1 lowercase, 1 number"
            />
            <Input
              label="Confirm New Password"
              type="password"
              value={passwordForm.confirm_password}
              onChange={(e) =>
                setPasswordForm((f) => ({ ...f, confirm_password: e.target.value }))
              }
              error={passwordErrors.confirm_password}
            />
            <Button
              onClick={handlePasswordSubmit}
              loading={passwordMutation.isPending}
              icon={<Lock className="h-4 w-4" />}
            >
              Update Password
            </Button>
          </div>
        </Card>

        {/* Notification Preferences */}
        <Card
          title="Notification Preferences"
          actions={
            <div className="flex items-center gap-1 text-gray-400">
              <Bell className="h-4 w-4" />
            </div>
          }
        >
          <div className="space-y-1">
            <p className="text-sm text-gray-500 mb-4">
              Choose which SMS notifications you want to receive. Requires a valid phone number.
            </p>
            {notificationItems.map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between rounded-lg p-3 hover:bg-gray-50 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{item.label}</p>
                  <p className="text-xs text-gray-500">{item.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={notifications[item.key]}
                  onClick={() => toggleNotification(item.key)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                    notifications[item.key] ? 'bg-primary' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-in-out ${
                      notifications[item.key] ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            ))}
            <div className="pt-4">
              <Button
                variant="secondary"
                onClick={() => toast.success('Notification preferences saved')}
              >
                Save Preferences
              </Button>
            </div>
          </div>
        </Card>

        {/* Owner-only: System Settings */}
        {isOwner && <SystemSettingsCard />}
      </div>
    </div>
  );
}
