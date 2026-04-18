import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Coffee, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { auth } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await auth.login({ email, password });
      login(res.user, res.access_token);
      toast.success(`Welcome back, ${res.user.first_name}!`);
      navigate('/portal/dashboard');
    } catch {
      setError('Invalid email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim()) return;
    setResetLoading(true);
    try {
      await auth.resetPassword({ email: resetEmail });
      setResetSent(true);
    } catch {
      // Show success even on error to prevent email enumeration
      setResetSent(true);
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{
        background:
          'linear-gradient(135deg, rgba(111, 78, 55, 0.05) 0%, rgba(245, 230, 204, 0.3) 50%, rgba(45, 80, 22, 0.05) 100%)',
      }}
    >
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <Link to="/" className="inline-flex flex-col items-center gap-3 group">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full shadow-md transition-transform group-hover:scale-105"
              style={{ backgroundColor: '#6F4E37' }}
            >
              <Coffee className="h-9 w-9 text-white" />
            </div>
            <div>
              <span
                className="text-2xl font-bold"
                style={{ color: '#6F4E37' }}
              >
                Six Beans Coffee Co.
              </span>
              <p className="mt-1 text-sm text-gray-500">Employee Portal</p>
            </div>
          </Link>
        </div>

        {/* Login Card */}
        {!showForgotPassword ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-lg">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                placeholder="you@sixbeans.com"
                required
                autoFocus
              />

              <div className="relative">
                <Input
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-[34px] text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  className="text-sm font-medium hover:underline"
                  style={{ color: '#6F4E37' }}
                  onClick={() => setShowForgotPassword(true)}
                >
                  Forgot password?
                </button>
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                loading={loading}
                style={{ backgroundColor: '#6F4E37' }}
              >
                Sign In
              </Button>
            </form>

            <div className="mt-6 border-t border-gray-100 pt-6 text-center">
              <p className="text-sm text-gray-500">
                Need to clock in quickly?{' '}
                <Link
                  to="/kiosk"
                  className="font-medium hover:underline"
                  style={{ color: '#6F4E37' }}
                >
                  Use Kiosk Mode
                </Link>
              </p>
            </div>
          </div>
        ) : (
          /* Forgot Password Card */
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-lg">
            {!resetSent ? (
              <form onSubmit={handleForgotPassword} className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Reset Password
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Enter your email address and we will send you a link to reset
                    your password.
                  </p>
                </div>

                <Input
                  label="Email"
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="you@sixbeans.com"
                  required
                  autoFocus
                />

                <Button
                  type="submit"
                  className="w-full"
                  loading={resetLoading}
                  style={{ backgroundColor: '#6F4E37' }}
                >
                  Send Reset Link
                </Button>

                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-700"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setResetEmail('');
                    setResetSent(false);
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to login
                </button>
              </form>
            ) : (
              <div className="text-center py-4">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <Coffee className="h-6 w-6 text-green-600" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Check Your Email
                </h2>
                <p className="mt-2 text-sm text-gray-500">
                  If an account exists for <strong>{resetEmail}</strong>, we have
                  sent a password reset link.
                </p>
                <button
                  type="button"
                  className="mt-6 flex w-full items-center justify-center gap-2 text-sm font-medium hover:underline"
                  style={{ color: '#6F4E37' }}
                  onClick={() => {
                    setShowForgotPassword(false);
                    setResetEmail('');
                    setResetSent(false);
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to login
                </button>
              </div>
            )}
          </div>
        )}

        {/* Back to website */}
        <div className="mt-6 text-center">
          <Link
            to="/"
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            &larr; Back to Six Beans Coffee Co.
          </Link>
        </div>
      </div>
    </div>
  );
}
