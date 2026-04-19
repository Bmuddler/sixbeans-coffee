import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  FileText,
  CheckCircle2,
  AlertCircle,
  ClipboardList,
  UserCheck,
  ChevronRight,
  Upload,
  Download,
  Trash2,
  Plus,
  File,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuthStore } from '@/stores/authStore';
import { forms, companyDocs } from '@/lib/api';
import { formatTime } from '@/lib/timezone';
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

const DOC_CATEGORIES = [
  { value: 'Onboarding', label: 'Onboarding' },
  { value: 'Company Policies', label: 'Company Policies' },
  { value: 'Training', label: 'Training' },
  { value: 'Forms', label: 'Forms' },
  { value: 'Other', label: 'Other' },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const isManagerOrOwner = user?.role === UserRole.MANAGER || user?.role === UserRole.OWNER;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState('Onboarding');
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const { data: myForms, isLoading: myFormsLoading } = useQuery({
    queryKey: ['my-forms'],
    queryFn: forms.getMy,
  });

  const { data: docsList, isLoading: docsLoading } = useQuery({
    queryKey: ['company-docs'],
    queryFn: companyDocs.list,
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!uploadFile) throw new Error('No file selected');
      return companyDocs.upload(uploadFile, uploadTitle, uploadCategory);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-docs'] });
      setShowUploadModal(false);
      setUploadTitle('');
      setUploadCategory('Onboarding');
      setUploadFile(null);
      toast.success('Document uploaded!');
    },
    onError: () => toast.error('Failed to upload document'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => companyDocs.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-docs'] });
      toast.success('Document deleted');
    },
    onError: () => toast.error('Failed to delete document'),
  });

  const handleUpload = () => {
    if (!uploadFile || !uploadTitle.trim()) {
      toast.error('Please provide a title and select a file');
      return;
    }
    uploadMutation.mutate();
  };

  const handleDownload = async (docId: number, filename: string) => {
    try {
      const token = localStorage.getItem('token');
      const url = companyDocs.downloadUrl(docId);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error('Failed to download');
    }
  };

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
      <Card
        title="Company Documents"
        actions={isManagerOrOwner ? (
          <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => setShowUploadModal(true)}>Upload Document</Button>
        ) : undefined}
      >
        {docsLoading ? (
          <LoadingSpinner size="sm" />
        ) : (docsList ?? []).length > 0 ? (
          <div className="space-y-2">
            {(docsList ?? []).map((doc: any) => (
              <div key={doc.id} className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 transition-colors group">
                <File className="h-5 w-5 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{doc.title}</p>
                  <p className="text-xs text-gray-500">
                    {doc.category} · {formatFileSize(doc.file_size)} · {doc.filename}
                    {doc.uploaded_by_name && ` · Uploaded by ${doc.uploaded_by_name}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleDownload(doc.id, doc.filename)} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary" title="Download">
                    <Download className="h-4 w-4" />
                  </button>
                  {isManagerOrOwner && (
                    <button onClick={() => { if (confirm(`Delete "${doc.title}"?`)) deleteMutation.mutate(doc.id); }} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 py-4 text-center">
            {isManagerOrOwner ? 'No documents uploaded yet. Click "Upload Document" to add one.' : 'No company documents available yet.'}
          </p>
        )}
      </Card>

      {/* Upload Modal */}
      <Modal open={showUploadModal} onClose={() => setShowUploadModal(false)} title="Upload Company Document">
        <div className="space-y-4">
          <Input label="Document Title *" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="e.g., Employee Handbook" />
          <Select label="Category" options={DOC_CATEGORIES} value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">File *</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
            />
            <p className="text-xs text-gray-400 mt-1">PDF, Word, images, or text files. Max 10MB.</p>
          </div>
          {uploadFile && (
            <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
              <p><strong>{uploadFile.name}</strong> ({formatFileSize(uploadFile.size)})</p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowUploadModal(false)}>Cancel</Button>
            <Button onClick={handleUpload} loading={uploadMutation.isPending} disabled={!uploadFile || !uploadTitle.trim()}>Upload</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
