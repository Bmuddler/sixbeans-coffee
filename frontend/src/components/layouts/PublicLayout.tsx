import { Outlet, Link } from 'react-router-dom';
import { Coffee } from 'lucide-react';

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2">
            <Coffee className="h-8 w-8 text-primary" />
            <span className="text-xl font-bold text-primary">Six Beans Coffee Co.</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              to="/login"
              className="rounded-lg px-4 py-2 text-sm font-medium text-primary hover:bg-primary-50 transition-colors"
            >
              Employee Login
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500">
            &copy; {new Date().getFullYear()} Six Beans Coffee Co. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
