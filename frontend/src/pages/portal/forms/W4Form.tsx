import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { forms } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

function formatSsn(digits: string): string {
  const d = (digits ?? '').replace(/\D/g, '').slice(0, 9);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

const FILING_STATUS_OPTIONS = [
  { value: 'single', label: 'Single or Married filing separately' },
  { value: 'married', label: 'Married filing jointly' },
  { value: 'head_of_household', label: 'Head of household' },
];

interface W4Data {
  first_name: string;
  last_name: string;
  ssn: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  filing_status: string;
  multiple_jobs: boolean;
  dependents_amount: string;
  other_income: string;
  deductions: string;
  extra_withholding: string;
  exempt: boolean;
  signature: string;
  signature_date: string;
}

const defaultW4: W4Data = {
  first_name: '',
  last_name: '',
  ssn: '',
  address: '',
  city: '',
  state: 'CA',
  zip: '',
  filing_status: 'single',
  multiple_jobs: false,
  dependents_amount: '',
  other_income: '',
  deductions: '',
  extra_withholding: '',
  exempt: false,
  signature: '',
  signature_date: new Date().toISOString().split('T')[0],
};

export function W4Form() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<W4Data>({ ...defaultW4, first_name: user?.first_name ?? '', last_name: user?.last_name ?? '' });
  const [submitted, setSubmitted] = useState(false);

  const { data: existing } = useQuery({
    queryKey: ['my-forms'],
    queryFn: forms.getMy,
  });

  useEffect(() => {
    const w4 = existing?.find((f: any) => f.form_type === 'w4');
    if (w4) {
      setForm({ ...defaultW4, ...w4.form_data });
      setSubmitted(true);
    }
  }, [existing]);

  const submitMutation = useMutation({
    mutationFn: () => forms.submit({ form_type: 'w4', form_data: form }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-forms'] });
      queryClient.invalidateQueries({ queryKey: ['form-status'] });
      setSubmitted(true);
      toast.success('W-4 form submitted successfully!');
    },
    onError: () => toast.error('Failed to submit W-4 form'),
  });

  const handleSubmit = () => {
    if (!form.first_name || !form.last_name || !form.signature) {
      toast.error('Please fill in your name and sign the form');
      return;
    }
    if (form.ssn.replace(/\D/g, '').length !== 9) {
      toast.error('Please enter your full 9-digit Social Security Number');
      return;
    }
    submitMutation.mutate();
  };

  const set = (field: keyof W4Data, value: any) => setForm((f) => ({ ...f, [field]: value }));

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link to="/portal/documents" className="text-sm text-gray-500 hover:text-primary flex items-center gap-1 mb-2">
          <ArrowLeft className="h-4 w-4" /> Back to Documents
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Form W-4</h1>
        <p className="text-sm text-gray-500 mt-1">Employee's Withholding Certificate</p>
        {submitted && (
          <div className="mt-2 flex items-center gap-2 text-green-600 text-sm">
            <Check className="h-4 w-4" /> Previously submitted — you can update and resubmit.
          </div>
        )}
      </div>

      {/* Step 1: Personal Info */}
      <Card title="Step 1: Personal Information" className="mb-4">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="First Name *" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
            <Input label="Last Name *" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
          </div>
          <Input
            label="Social Security Number *"
            type="text"
            inputMode="numeric"
            maxLength={11}
            value={formatSsn(form.ssn)}
            onChange={(e) => set('ssn', e.target.value.replace(/\D/g, '').slice(0, 9))}
            placeholder="XXX-XX-XXXX"
            helperText="Required by the IRS on Form W-4. The PDF is stored securely and only visible to the owner; your full SSN is not saved in the database."
          />
          <Input label="Address" value={form.address} onChange={(e) => set('address', e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="City" value={form.city} onChange={(e) => set('city', e.target.value)} />
            <Input label="State" value={form.state} onChange={(e) => set('state', e.target.value)} />
            <Input label="ZIP Code" value={form.zip} onChange={(e) => set('zip', e.target.value)} />
          </div>
          <Select label="Filing Status *" options={FILING_STATUS_OPTIONS} value={form.filing_status} onChange={(e) => set('filing_status', e.target.value)} />
        </div>
      </Card>

      {/* Step 2: Multiple Jobs */}
      <Card title="Step 2: Multiple Jobs or Spouse Works" className="mb-4">
        <div className="space-y-3">
          <p className="text-sm text-gray-500">Complete this step if you hold more than one job at a time, or if you're married filing jointly and your spouse also works.</p>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={form.multiple_jobs} onChange={(e) => set('multiple_jobs', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-primary" />
            <span className="text-sm text-gray-700">Check here if you have multiple jobs or your spouse works</span>
          </label>
        </div>
      </Card>

      {/* Step 3: Dependents */}
      <Card title="Step 3: Claim Dependents" className="mb-4">
        <div className="space-y-3">
          <p className="text-sm text-gray-500">If your total income will be $200,000 or less ($400,000 if married filing jointly), enter the amount from the worksheet.</p>
          <Input label="Total amount for dependents ($)" type="number" step="0.01" value={form.dependents_amount} onChange={(e) => set('dependents_amount', e.target.value)} placeholder="0.00" />
        </div>
      </Card>

      {/* Step 4: Other Adjustments */}
      <Card title="Step 4: Other Adjustments (Optional)" className="mb-4">
        <div className="space-y-4">
          <Input label="(a) Other income (not from jobs) — $" type="number" step="0.01" value={form.other_income} onChange={(e) => set('other_income', e.target.value)} placeholder="0.00" helperText="Interest, dividends, retirement income" />
          <Input label="(b) Deductions — $" type="number" step="0.01" value={form.deductions} onChange={(e) => set('deductions', e.target.value)} placeholder="0.00" helperText="If you expect to claim deductions other than the standard deduction" />
          <Input label="(c) Extra withholding per pay period — $" type="number" step="0.01" value={form.extra_withholding} onChange={(e) => set('extra_withholding', e.target.value)} placeholder="0.00" />
        </div>
      </Card>

      {/* Exempt */}
      <Card title="Exempt Status" className="mb-4">
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={form.exempt} onChange={(e) => set('exempt', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-primary" />
          <span className="text-sm text-gray-700">I claim exemption from withholding (see IRS instructions)</span>
        </label>
      </Card>

      {/* Signature */}
      <Card title="Step 5: Sign Here" className="mb-6">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Under penalties of perjury, I declare that this certificate has been examined by me and that it is true, correct, and complete.</p>
          <Input label="Electronic Signature (type your full name) *" value={form.signature} onChange={(e) => set('signature', e.target.value)} placeholder="Type your full legal name" />
          <Input label="Date" type="date" value={form.signature_date} onChange={(e) => set('signature_date', e.target.value)} />
          <div className="flex justify-end gap-3">
            <Link to="/portal/documents"><Button variant="ghost">Cancel</Button></Link>
            <Button onClick={handleSubmit} loading={submitMutation.isPending}>{submitted ? 'Update W-4' : 'Submit W-4'}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
