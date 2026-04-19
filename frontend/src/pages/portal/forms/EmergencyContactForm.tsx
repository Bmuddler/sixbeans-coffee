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

const RELATIONSHIP_OPTIONS = [
  { value: 'spouse', label: 'Spouse' },
  { value: 'parent', label: 'Parent' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'child', label: 'Child' },
  { value: 'friend', label: 'Friend' },
  { value: 'other', label: 'Other' },
];

interface EmergencyData {
  employee_name: string;
  employee_phone: string;
  employee_address: string;
  primary_contact_name: string;
  primary_contact_relationship: string;
  primary_contact_phone: string;
  primary_contact_alt_phone: string;
  secondary_contact_name: string;
  secondary_contact_relationship: string;
  secondary_contact_phone: string;
  medical_conditions: string;
  allergies: string;
  medications: string;
  physician_name: string;
  physician_phone: string;
  signature: string;
  signature_date: string;
}

const defaultData: EmergencyData = {
  employee_name: '',
  employee_phone: '',
  employee_address: '',
  primary_contact_name: '',
  primary_contact_relationship: 'parent',
  primary_contact_phone: '',
  primary_contact_alt_phone: '',
  secondary_contact_name: '',
  secondary_contact_relationship: 'spouse',
  secondary_contact_phone: '',
  medical_conditions: '',
  allergies: '',
  medications: '',
  physician_name: '',
  physician_phone: '',
  signature: '',
  signature_date: new Date().toISOString().split('T')[0],
};

export function EmergencyContactForm() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EmergencyData>({
    ...defaultData,
    employee_name: user ? `${user.first_name} ${user.last_name}` : '',
    employee_phone: user?.phone ?? '',
  });
  const [submitted, setSubmitted] = useState(false);

  const { data: existing } = useQuery({
    queryKey: ['my-forms'],
    queryFn: forms.getMy,
  });

  useEffect(() => {
    const ec = existing?.find((f: any) => f.form_type === 'emergency_contact');
    if (ec) {
      setForm({ ...defaultData, ...ec.form_data });
      setSubmitted(true);
    }
  }, [existing]);

  const submitMutation = useMutation({
    mutationFn: () => forms.submit({ form_type: 'emergency_contact', form_data: form }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-forms'] });
      queryClient.invalidateQueries({ queryKey: ['form-status'] });
      setSubmitted(true);
      toast.success('Emergency contact form submitted!');
    },
    onError: () => toast.error('Failed to submit form'),
  });

  const handleSubmit = () => {
    if (!form.primary_contact_name || !form.primary_contact_phone) {
      toast.error('Please fill in at least one emergency contact');
      return;
    }
    if (!form.signature) {
      toast.error('Please sign the form');
      return;
    }
    submitMutation.mutate();
  };

  const set = (field: keyof EmergencyData, value: string) => setForm((f) => ({ ...f, [field]: value }));

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link to="/portal/documents" className="text-sm text-gray-500 hover:text-primary flex items-center gap-1 mb-2">
          <ArrowLeft className="h-4 w-4" /> Back to Documents
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Emergency Contact Form</h1>
        <p className="text-sm text-gray-500 mt-1">Provide your emergency contact information</p>
        {submitted && (
          <div className="mt-2 flex items-center gap-2 text-green-600 text-sm">
            <Check className="h-4 w-4" /> Previously submitted — you can update and resubmit.
          </div>
        )}
      </div>

      {/* Employee Info */}
      <Card title="Your Information" className="mb-4">
        <div className="space-y-4">
          <Input label="Full Name" value={form.employee_name} onChange={(e) => set('employee_name', e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Phone" type="tel" value={form.employee_phone} onChange={(e) => set('employee_phone', e.target.value)} />
          </div>
          <Input label="Home Address" value={form.employee_address} onChange={(e) => set('employee_address', e.target.value)} />
        </div>
      </Card>

      {/* Primary Contact */}
      <Card title="Primary Emergency Contact *" className="mb-4">
        <div className="space-y-4">
          <Input label="Contact Name *" value={form.primary_contact_name} onChange={(e) => set('primary_contact_name', e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Relationship" options={RELATIONSHIP_OPTIONS} value={form.primary_contact_relationship} onChange={(e) => set('primary_contact_relationship', e.target.value)} />
            <Input label="Phone Number *" type="tel" value={form.primary_contact_phone} onChange={(e) => set('primary_contact_phone', e.target.value)} />
          </div>
          <Input label="Alternate Phone" type="tel" value={form.primary_contact_alt_phone} onChange={(e) => set('primary_contact_alt_phone', e.target.value)} />
        </div>
      </Card>

      {/* Secondary Contact */}
      <Card title="Secondary Emergency Contact (Optional)" className="mb-4">
        <div className="space-y-4">
          <Input label="Contact Name" value={form.secondary_contact_name} onChange={(e) => set('secondary_contact_name', e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Relationship" options={RELATIONSHIP_OPTIONS} value={form.secondary_contact_relationship} onChange={(e) => set('secondary_contact_relationship', e.target.value)} />
            <Input label="Phone Number" type="tel" value={form.secondary_contact_phone} onChange={(e) => set('secondary_contact_phone', e.target.value)} />
          </div>
        </div>
      </Card>

      {/* Medical Info */}
      <Card title="Medical Information (Optional)" className="mb-4">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">This information will only be used in case of a medical emergency at work.</p>
          <Input label="Known Medical Conditions" value={form.medical_conditions} onChange={(e) => set('medical_conditions', e.target.value)} placeholder="e.g., diabetes, asthma, epilepsy" />
          <Input label="Allergies" value={form.allergies} onChange={(e) => set('allergies', e.target.value)} placeholder="e.g., penicillin, peanuts, bee stings" />
          <Input label="Current Medications" value={form.medications} onChange={(e) => set('medications', e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Physician Name" value={form.physician_name} onChange={(e) => set('physician_name', e.target.value)} />
            <Input label="Physician Phone" type="tel" value={form.physician_phone} onChange={(e) => set('physician_phone', e.target.value)} />
          </div>
        </div>
      </Card>

      {/* Signature */}
      <Card title="Signature" className="mb-6">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">I certify that the above information is accurate and authorize Six Beans Coffee Co. to contact the listed individuals in case of an emergency.</p>
          <Input label="Electronic Signature (type your full name) *" value={form.signature} onChange={(e) => set('signature', e.target.value)} placeholder="Type your full name" />
          <Input label="Date" type="date" value={form.signature_date} onChange={(e) => set('signature_date', e.target.value)} />
          <div className="flex justify-end gap-3">
            <Link to="/portal/documents"><Button variant="ghost">Cancel</Button></Link>
            <Button onClick={handleSubmit} loading={submitMutation.isPending}>{submitted ? 'Update' : 'Submit'}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
