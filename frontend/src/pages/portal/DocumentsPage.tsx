import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  FileText,
  CheckCircle2,
  AlertCircle,
  ClipboardList,
  UserCheck,
  ChevronRight,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuthStore } from '@/stores/authStore';
import { forms } from '@/lib/api';
import { UserRole } from '@/types';

const REQUIRED_FORMS = [
  {
    type: 'w4',
    title: 'W-4 — Employee Withholding Certificate',
    description: 'Federal tax withholding form required for all employees.',
    icon: <FileText className="h-6 w-6" />,
    path: '/portal/documents/w4',
  },
  {
    type: 'emergency_contact',
    title: 'Emergency Contact Form',
    description: 'Emergency contact and medical information.',
    icon: <UserCheck className="h-6 w-6" />,
    path: '/portal/documents/emergency-contact',
  },
];

export function DocumentsPage() {
  const user = useAuthStore((s) => s.user);
  const isManagerOrOwner = user?.role === UserRole.MANAGER || user?.role === UserRole.OWNER;

  const { data: myForms, isLoading: myFormsLoading } = useQuery({
    queryKey: ['my-forms'],
    queryFn: forms.getMy,
  });

  const { data: allStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['form-status'],
    queryFn: forms.getStatus,
    enabled: isManagerOrOwner,
  });

  const myCompletedTypes = new Set((myForms ?? []).map((f: any) => f.form_type));

  const completedCount = allStatus?.filter((s: any) => s.w4_completed && s.emergency_contact_completed).length ?? 0;
  const totalEmployees = allStatus?.length ?? 0;
  const w4Count = allStatus?.filter((s: any) => s.w4_completed).length ?? 0;
  const ecCount = allStatus?.filter((s: any) => s.emergency_contact_completed).length ?? 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Documents</h1>
          <p className="page-subtitle">Onboarding forms and company documents.</p>
        </div>
      </div>

      {/* Required Forms */}
      <Card title="Required Forms" className="mb-6">
        <p className="text-sm text-gray-500 mb-4">Complete these forms as part of your onboarding. You can update them at any time.</p>
        {myFormsLoading ? (
          <LoadingSpinner size="sm" />
        ) : (
          <div className="space-y-3">
            {REQUIRED_FORMS.map((form) => {
              const isCompleted = myCompletedTypes.has(form.type);
              return (
                <Link
                  key={form.type}
                  to={form.path}
                  className={`flex items-center gap-4 rounded-lg border p-4 transition-colors hover:border-primary/30 ${
                    isCompleted ? 'bg-green-50/50 border-green-200' : 'bg-white border-gray-200'
                  }`}
                >
                  <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${isCompleted ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                    {form.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{form.title}</p>
                      {isCompleted ? <Badge variant="approved">Completed</Badge> : <Badge variant="pending">Required</Badge>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{form.description}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      {/* Manager/Owner: Completion Status */}
      {isManagerOrOwner && (
        <Card title="Employee Form Completion" className="mb-6" actions={<span className="text-sm text-gray-500">{completedCount}/{totalEmployees} fully complete</span>}>
          {statusLoading ? (
            <LoadingSpinner size="sm" />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="rounded-lg bg-gray-50 p-3 text-center">
                  <p className="text-2xl font-bold text-gray-900">{totalEmployees}</p>
                  <p className="text-xs text-gray-500">Total Employees</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{w4Count}</p>
                  <p className="text-xs text-gray-500">W-4 Submitted</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 text-center">
                  <p className="text-2xl font-bold text-purple-600">{ecCount}</p>
                  <p className="text-xs text-gray-500">Emergency Contact</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Employee</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-gray-500">W-4</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-gray-500">Emergency Contact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {(allStatus ?? []).map((emp: any) => (
                      <tr key={emp.employee_id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-sm text-gray-900">{emp.employee_name}</td>
                        <td className="px-4 py-2.5 text-center">
                          {emp.w4_completed ? <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto" /> : <AlertCircle className="h-5 w-5 text-gray-300 mx-auto" />}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {emp.emergency_contact_completed ? <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto" /> : <AlertCircle className="h-5 w-5 text-gray-300 mx-auto" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}

      {/* Company Documents */}
      <Card title="Company Documents">
        <div className="space-y-3">
          {[
            { title: 'Employee Handbook', desc: 'Company policies, code of conduct, and guidelines.' },
            { title: 'California Break Policy', desc: 'State-required break and meal period rules.' },
            { title: 'Safety & Hygiene Standards', desc: 'Food safety and workplace hygiene requirements.' },
            { title: 'Anti-Harassment Policy', desc: 'Workplace harassment prevention and reporting.' },
          ].map((doc) => (
            <div key={doc.title} className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 transition-colors">
              <ClipboardList className="h-5 w-5 text-gray-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-900">{doc.title}</p>
                <p className="text-xs text-gray-500">{doc.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
