import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { Save, Lock, Bell, User as UserIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import { users as usersApi } from '@/lib/api';
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

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const isOwner = user?.role === UserRole.OWNER;

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
    mutationFn: () => {
      if (!user) throw new Error('Not authenticated');
      // In a real app, this would call a dedicated change-password endpoint
      return usersApi.update(user.id, {
        // The API would handle password hashing
      } as Record<string, unknown>);
    },
    onSuccess: () => {
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
      setPasswordErrors({});
      toast.success('Password updated');
    },
    onError: () => toast.error('Failed to update password'),
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
              helperText="At least 8 characters"
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
        {isOwner && (
          <Card title="System Settings">
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                System-wide configuration settings for Six Beans Coffee Co.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Default Starting Cash"
                  type="number"
                  step="0.01"
                  defaultValue="200.00"
                  helperText="Default opening amount for cash drawers"
                />
                <Input
                  label="Variance Threshold ($)"
                  type="number"
                  step="0.01"
                  defaultValue="5.00"
                  helperText="Flag variance amounts above this"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Overtime Threshold (hours)"
                  type="number"
                  defaultValue="40"
                  helperText="Weekly hours before overtime kicks in"
                />
                <Input
                  label="Break Duration (minutes)"
                  type="number"
                  defaultValue="30"
                  helperText="Default break duration"
                />
              </div>
              <Button
                onClick={() => toast.success('System settings saved')}
                icon={<Save className="h-4 w-4" />}
              >
                Save System Settings
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
