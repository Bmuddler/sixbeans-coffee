import { Routes, Route, Navigate } from 'react-router-dom';
import { UserRole } from '@/types';

// Layouts
import { PublicLayout } from '@/components/layouts/PublicLayout';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { KioskLayout } from '@/components/layouts/KioskLayout';
import { ProtectedRoute } from '@/components/ProtectedRoute';

// Public pages
import { LandingPage } from '@/pages/public/LandingPage';
import { LoginPage } from '@/pages/public/LoginPage';

// Kiosk
import { KioskPage } from '@/pages/kiosk/KioskPage';

// Portal pages
import { DashboardPage } from '@/pages/portal/DashboardPage';
import { SchedulePage } from '@/pages/portal/SchedulePage';
import { TimeOffPage } from '@/pages/portal/TimeOffPage';
import { ShiftSwapsPage } from '@/pages/portal/ShiftSwapsPage';
import { MessagesPage } from '@/pages/portal/MessagesPage';
import { DocumentsPage } from '@/pages/portal/DocumentsPage';
import { W4Form } from '@/pages/portal/forms/W4Form';
import { EmergencyContactForm } from '@/pages/portal/forms/EmergencyContactForm';
import { TimeClockPage } from '@/pages/portal/TimeClockPage';
import { CashDrawerPage } from '@/pages/portal/CashDrawerPage';
import { PayrollPage } from '@/pages/portal/PayrollPage';
import { EmployeesPage } from '@/pages/portal/EmployeesPage';
import { LocationsPage } from '@/pages/portal/LocationsPage';
import { AuditLogPage } from '@/pages/portal/AuditLogPage';
import { SettingsPage } from '@/pages/portal/SettingsPage';
import { SupplyOrderPage } from '@/pages/portal/SupplyOrderPage';
import { USFoodsPage } from '@/pages/portal/USFoodsPage';
import { AnalyticsAdminPage } from '@/pages/portal/admin/AnalyticsAdminPage';
import { ExpensesAdminPage } from '@/pages/portal/admin/ExpensesAdminPage';
import { InsightsPage } from '@/pages/portal/InsightsPage';
import { ApplicationsPage } from '@/pages/portal/ApplicationsPage';
import { BankingPage } from '@/pages/portal/BankingPage';
import { RecipesPage } from '@/pages/portal/RecipesPage';

export function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Kiosk - separate layout, no nav */}
      <Route element={<KioskLayout />}>
        <Route path="/kiosk" element={<KioskPage />} />
      </Route>

      {/* Protected portal routes */}
      <Route
        element={
          <ProtectedRoute>
            <PortalLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/portal" element={<Navigate to="/portal/dashboard" replace />} />
        <Route path="/portal/dashboard" element={<DashboardPage />} />
        <Route path="/portal/schedule" element={<SchedulePage />} />
        <Route path="/portal/time-off" element={<TimeOffPage />} />
        <Route path="/portal/shift-swaps" element={<ShiftSwapsPage />} />
        <Route path="/portal/messages" element={<MessagesPage />} />
        <Route path="/portal/documents" element={<DocumentsPage />} />
        <Route path="/portal/documents/w4" element={<W4Form />} />
        <Route path="/portal/documents/emergency-contact" element={<EmergencyContactForm />} />
        <Route path="/portal/time-clock" element={<TimeClockPage />} />
        <Route
          path="/portal/cash-drawer"
          element={
            <ProtectedRoute requiredRoles={[UserRole.MANAGER, UserRole.OWNER]}>
              <CashDrawerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal/payroll"
          element={
            <ProtectedRoute requiredRoles={[UserRole.OWNER]}>
              <PayrollPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal/employees"
          element={
            <ProtectedRoute requiredRoles={[UserRole.MANAGER, UserRole.OWNER]}>
              <EmployeesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal/locations"
          element={
            <ProtectedRoute requiredRoles={[UserRole.OWNER]}>
              <LocationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal/audit-log"
          element={
            <ProtectedRoute requiredRoles={[UserRole.OWNER]}>
              <AuditLogPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal/supply-orders"
          element={
            <ProtectedRoute requiredRoles={[UserRole.MANAGER, UserRole.OWNER]}>
              <SupplyOrderPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal/usfoods"
          element={
            <ProtectedRoute requiredRoles={[UserRole.OWNER]}>
              <USFoodsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal/insights"
          element={
            <ProtectedRoute requiredRoles={[UserRole.OWNER]}>
              <InsightsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal/admin/analytics"
          element={
            <ProtectedRoute requiredRoles={[UserRole.OWNER]}>
              <AnalyticsAdminPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal/applications"
          element={
            <ProtectedRoute requiredRoles={[UserRole.OWNER]}>
              <ApplicationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal/banking"
          element={
            <ProtectedRoute requiredRoles={[UserRole.OWNER]}>
              <BankingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal/recipes"
          element={
            <ProtectedRoute requiredRoles={[UserRole.OWNER]}>
              <RecipesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal/admin/expenses"
          element={
            <ProtectedRoute requiredRoles={[UserRole.OWNER]}>
              <ExpensesAdminPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
