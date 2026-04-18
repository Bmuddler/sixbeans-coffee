import { useState, useMemo } from 'react';
import {
  FileText,
  Search,
  Upload,
  FolderOpen,
  BookOpen,
  GraduationCap,
  ClipboardList,
  Shield,
  Download,
  Eye,
  Calendar,
  ChevronRight,
  Plus,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useAuthStore } from '@/stores/authStore';
import { UserRole } from '@/types';

// ============================================================
// Document types (local, since this is a UI-ready page)
// ============================================================

interface Document {
  id: number;
  title: string;
  description: string;
  category: DocumentCategory;
  lastUpdated: string;
  fileType: 'pdf' | 'docx' | 'xlsx' | 'png' | 'link';
  size?: string;
  required?: boolean;
}

type DocumentCategory = 'onboarding' | 'policies' | 'training' | 'forms';

const CATEGORY_META: Record<
  DocumentCategory,
  { label: string; icon: React.ReactNode; color: string }
> = {
  onboarding: {
    label: 'Onboarding',
    icon: <BookOpen className="h-5 w-5" />,
    color: 'bg-blue-50 text-blue-600',
  },
  policies: {
    label: 'Company Policies',
    icon: <Shield className="h-5 w-5" />,
    color: 'bg-purple-50 text-purple-600',
  },
  training: {
    label: 'Training',
    icon: <GraduationCap className="h-5 w-5" />,
    color: 'bg-green-50 text-green-600',
  },
  forms: {
    label: 'Forms',
    icon: <ClipboardList className="h-5 w-5" />,
    color: 'bg-amber-50 text-amber-600',
  },
};

// Sample documents for the UI
const SAMPLE_DOCUMENTS: Document[] = [
  {
    id: 1,
    title: 'Employee Handbook 2024',
    description:
      'Complete guide to company policies, benefits, and workplace expectations.',
    category: 'onboarding',
    lastUpdated: '2024-01-15',
    fileType: 'pdf',
    size: '2.4 MB',
    required: true,
  },
  {
    id: 2,
    title: 'New Hire Checklist',
    description:
      'Step-by-step checklist for your first week at Six Beans Coffee Co.',
    category: 'onboarding',
    lastUpdated: '2024-02-01',
    fileType: 'pdf',
    size: '340 KB',
    required: true,
  },
  {
    id: 3,
    title: 'Direct Deposit Form',
    description: 'Set up or update your direct deposit banking information.',
    category: 'onboarding',
    lastUpdated: '2024-01-10',
    fileType: 'pdf',
    size: '125 KB',
  },
  {
    id: 4,
    title: 'Code of Conduct',
    description:
      'Standards of behavior and professional conduct expected of all team members.',
    category: 'policies',
    lastUpdated: '2024-03-01',
    fileType: 'pdf',
    size: '890 KB',
    required: true,
  },
  {
    id: 5,
    title: 'PTO & Leave Policy',
    description:
      'Guidelines for requesting time off, sick leave, and other absences.',
    category: 'policies',
    lastUpdated: '2024-01-20',
    fileType: 'pdf',
    size: '560 KB',
  },
  {
    id: 6,
    title: 'Cash Handling Procedures',
    description:
      'Proper procedures for opening/closing drawers, handling cash, and deposits.',
    category: 'policies',
    lastUpdated: '2024-02-15',
    fileType: 'pdf',
    size: '430 KB',
  },
  {
    id: 7,
    title: 'Food Safety & Hygiene',
    description:
      'Required food safety practices and health department compliance guidelines.',
    category: 'policies',
    lastUpdated: '2024-03-10',
    fileType: 'pdf',
    size: '1.1 MB',
  },
  {
    id: 8,
    title: 'Barista Training Manual',
    description:
      'Complete espresso, brewing, and drink preparation training guide.',
    category: 'training',
    lastUpdated: '2024-02-20',
    fileType: 'pdf',
    size: '5.2 MB',
  },
  {
    id: 9,
    title: 'POS System Guide',
    description: 'How to use the Square POS system for transactions and orders.',
    category: 'training',
    lastUpdated: '2024-01-25',
    fileType: 'pdf',
    size: '3.1 MB',
  },
  {
    id: 10,
    title: 'Customer Service Standards',
    description:
      'Best practices for providing exceptional customer experiences.',
    category: 'training',
    lastUpdated: '2024-03-05',
    fileType: 'pdf',
    size: '780 KB',
  },
  {
    id: 11,
    title: 'Opening & Closing Procedures',
    description:
      'Step-by-step procedures for opening and closing each location.',
    category: 'training',
    lastUpdated: '2024-02-28',
    fileType: 'pdf',
    size: '620 KB',
  },
  {
    id: 12,
    title: 'W-4 Tax Withholding Form',
    description: 'Federal tax withholding election form.',
    category: 'forms',
    lastUpdated: '2024-01-01',
    fileType: 'pdf',
    size: '210 KB',
    required: true,
  },
  {
    id: 13,
    title: 'Emergency Contact Form',
    description: 'Update your emergency contact information.',
    category: 'forms',
    lastUpdated: '2024-01-01',
    fileType: 'pdf',
    size: '95 KB',
    required: true,
  },
  {
    id: 14,
    title: 'Uniform Request Form',
    description: 'Request company uniforms, aprons, and name tags.',
    category: 'forms',
    lastUpdated: '2024-02-10',
    fileType: 'pdf',
    size: '88 KB',
  },
  {
    id: 15,
    title: 'Incident Report Form',
    description:
      'Report workplace incidents, injuries, or safety concerns.',
    category: 'forms',
    lastUpdated: '2024-01-15',
    fileType: 'pdf',
    size: '150 KB',
  },
];

function formatFileType(ft: string) {
  return ft.toUpperCase();
}

export function DocumentsPage() {
  const user = useAuthStore((s) => s.user);
  const isManagerOrOwner =
    user?.role === UserRole.MANAGER || user?.role === UserRole.OWNER;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<DocumentCategory | 'all'>(
    'all'
  );
  const [viewingDocument, setViewingDocument] = useState<Document | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadCategory, setUploadCategory] = useState<string>('onboarding');

  const filteredDocuments = useMemo(() => {
    let docs = SAMPLE_DOCUMENTS;
    if (selectedCategory !== 'all') {
      docs = docs.filter((d) => d.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      docs = docs.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.description.toLowerCase().includes(q)
      );
    }
    return docs;
  }, [selectedCategory, searchQuery]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: SAMPLE_DOCUMENTS.length };
    for (const doc of SAMPLE_DOCUMENTS) {
      counts[doc.category] = (counts[doc.category] ?? 0) + 1;
    }
    return counts;
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Documents</h1>
          <p className="page-subtitle">
            Onboarding documents, company policies, and resources.
          </p>
        </div>
        {isManagerOrOwner && (
          <Button
            icon={<Upload className="h-4 w-4" />}
            onClick={() => setShowUploadModal(true)}
          >
            Upload Document
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Sidebar - Categories */}
        <div className="lg:col-span-1">
          <Card title="Categories">
            <nav className="space-y-1">
              <button
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                  selectedCategory === 'all'
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
                onClick={() => setSelectedCategory('all')}
              >
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" />
                  All Documents
                </div>
                <span className="text-xs text-gray-400">
                  {categoryCounts.all}
                </span>
              </button>

              {(Object.keys(CATEGORY_META) as DocumentCategory[]).map(
                (category) => (
                  <button
                    key={category}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                      selectedCategory === category
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                    onClick={() => setSelectedCategory(category)}
                  >
                    <div className="flex items-center gap-2">
                      {CATEGORY_META[category].icon}
                      {CATEGORY_META[category].label}
                    </div>
                    <span className="text-xs text-gray-400">
                      {categoryCounts[category] ?? 0}
                    </span>
                  </button>
                )
              )}
            </nav>
          </Card>
        </div>

        {/* Main Content - Document List */}
        <div className="lg:col-span-3">
          {/* Search */}
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search documents..."
                className="block w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-300"
              />
            </div>
          </div>

          {/* Document Grid */}
          {filteredDocuments.length > 0 ? (
            <div className="space-y-3">
              {filteredDocuments.map((doc) => {
                const catMeta = CATEGORY_META[doc.category];
                return (
                  <div
                    key={doc.id}
                    className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-primary/30 hover:shadow transition-all cursor-pointer"
                    onClick={() => setViewingDocument(doc)}
                  >
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-lg flex-shrink-0 ${catMeta.color}`}
                    >
                      <FileText className="h-6 w-6" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 truncate">
                          {doc.title}
                        </h3>
                        {doc.required && (
                          <Badge variant="pending">Required</Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">
                        {doc.description}
                      </p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Updated{' '}
                          {new Date(doc.lastUpdated).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                        <span>{formatFileType(doc.fileType)}</span>
                        {doc.size && <span>{doc.size}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewingDocument(doc);
                        }}
                        title="View"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Download placeholder
                        }}
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Card>
              <EmptyState
                icon={<Search className="h-12 w-12" />}
                title="No Documents Found"
                description={
                  searchQuery
                    ? `No documents match "${searchQuery}". Try a different search term.`
                    : 'No documents in this category yet.'
                }
                action={
                  searchQuery ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSearchQuery('')}
                    >
                      Clear search
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          )}
        </div>
      </div>

      {/* Document Viewer Modal */}
      <Modal
        open={!!viewingDocument}
        onClose={() => setViewingDocument(null)}
        title={viewingDocument?.title ?? 'Document'}
        size="lg"
      >
        {viewingDocument && (
          <div>
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="info">
                  {CATEGORY_META[viewingDocument.category].label}
                </Badge>
                {viewingDocument.required && (
                  <Badge variant="pending">Required</Badge>
                )}
                <span className="text-xs text-gray-400">
                  {formatFileType(viewingDocument.fileType)} - {viewingDocument.size}
                </span>
              </div>
              <p className="text-sm text-gray-600">{viewingDocument.description}</p>
              <p className="mt-2 text-xs text-gray-400">
                Last updated:{' '}
                {new Date(viewingDocument.lastUpdated).toLocaleDateString([], {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>

            {/* Document preview placeholder */}
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center">
              <FileText className="mx-auto h-16 w-16 text-gray-300" />
              <p className="mt-4 text-sm font-medium text-gray-500">
                Document Preview
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Document viewing will be available once file storage is
                configured.
              </p>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => setViewingDocument(null)}
              >
                Close
              </Button>
              <Button icon={<Download className="h-4 w-4" />}>
                Download
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Upload Modal (Manager/Owner only) */}
      <Modal
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        title="Upload Document"
      >
        <div className="space-y-4">
          <Input
            label="Document Title"
            value={uploadTitle}
            onChange={(e) => setUploadTitle(e.target.value)}
            placeholder="e.g., Updated Safety Guidelines"
          />
          <div className="w-full">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              value={uploadDescription}
              onChange={(e) => setUploadDescription(e.target.value)}
              placeholder="Brief description of the document..."
              rows={3}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
          <Select
            label="Category"
            options={Object.entries(CATEGORY_META).map(([key, val]) => ({
              value: key,
              label: val.label,
            }))}
            value={uploadCategory}
            onChange={(e) => setUploadCategory(e.target.value)}
          />

          {/* File upload area */}
          <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center hover:border-primary/50 transition-colors cursor-pointer">
            <Upload className="mx-auto h-8 w-8 text-gray-400" />
            <p className="mt-2 text-sm font-medium text-gray-600">
              Click to upload or drag and drop
            </p>
            <p className="mt-1 text-xs text-gray-400">
              PDF, DOCX, XLSX up to 10MB
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="ghost"
              onClick={() => setShowUploadModal(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={!uploadTitle.trim()}
              icon={<Upload className="h-4 w-4" />}
            >
              Upload
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
