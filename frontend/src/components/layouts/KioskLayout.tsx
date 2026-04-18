import { Outlet } from 'react-router-dom';
import { Coffee } from 'lucide-react';

export function KioskLayout() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-primary-900 p-4">
      <div className="mb-8 flex items-center gap-3">
        <Coffee className="h-12 w-12 text-secondary" />
        <span className="text-3xl font-bold text-white">Six Beans Coffee Co.</span>
      </div>
      <div className="w-full max-w-lg">
        <Outlet />
      </div>
    </div>
  );
}
