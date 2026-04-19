import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Palmtree,
  Plus,
  Check,
  X,
  Calendar,
  Clock,
  Ban,
} from 'lucide-react';
import { format, parseISO, eachDayOfInterval, isSameMonth } from 'date-fns';
import toast from 'react-hot-toast';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { timeOff, unavailability } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import type { TimeOffRequest, UnavailabilityRequest, RequestStatus } from '@/types';
import { UserRole } from '@/types';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getStatusBadge(status: string) {
  switch (status) {
    case 'approved':
      return <Badge variant="approved">Approved</Badge>;
    case 'denied':
      return <Badge variant="denied">Denied</Badge>;
    default:
      return <Badge variant="pending">Pending</Badge>;
  }
}

export function TimeOffPage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();
  const isManager = currentUser?.role === UserRole.MANAGER || currentUser?.role === UserRole.OWNER;

  const [activeTab, setActiveTab] = useState<'requests' | 'unavailability' | 'calendar'>('requests');
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showUnavailModal, setShowUnavailModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewingRequest, setReviewingRequest] = useState<TimeOffRequest | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [page, setPage] = useState(1);

  // Request form
  const [requestForm, setRequestForm] = useState({
    start_date: '',
    end_date: '',
    reason: '',
  });

  // Unavailability form
  const [unavailForm, setUnavailForm] = useState({
    day_of_week: '1',
    start_time: '00:00',
    end_time: '23:59',
    reason: '',
  });

  // Queries
  const { data: myRequests, isLoading: requestsLoading } = useQuery({
    queryKey: ['timeOff', 'mine', page],
    queryFn: () => timeOff.list({ user_id: currentUser!.id, page, per_page: 10 }),
    enabled: !!currentUser,
  });

  const { data: pendingRequests, isLoading: pendingLoading } = useQuery({
    queryKey: ['timeOff', 'pending'],
    queryFn: () => timeOff.list({ status: 'pending' as RequestStatus, per_page: 50 }),
    enabled: isManager,
  });

  const { data: approvedRequests } = useQuery({
    queryKey: ['timeOff', 'approved'],
    queryFn: () => timeOff.list({ status: 'approved' as RequestStatus, per_page: 100 }),
  });

  const { data: myUnavailability } = useQuery({
    queryKey: ['unavailability', 'mine'],
    queryFn: () => unavailability.list({ user_id: currentUser!.id }),
    enabled: !!currentUser,
  });

  const { data: pendingUnavailability } = useQuery({
    queryKey: ['unavailability', 'pending'],
    queryFn: () => unavailability.list({ status: 'pending' as RequestStatus }),
    enabled: isManager,
  });

  // Mutations
  const createRequestMutation = useMutation({
    mutationFn: () =>
      timeOff.create({
        start_date: requestForm.start_date,
        end_date: requestForm.end_date,
        reason: requestForm.reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeOff'] });
      setShowRequestModal(false);
      setRequestForm({ start_date: '', end_date: '', reason: '' });
      toast.success('Time off request submitted');
    },
    onError: () => toast.error('Failed to submit request'),
  });

  const reviewMutation = useMutation({
    mutationFn: (status: RequestStatus) =>
      timeOff.review(reviewingRequest!.id, { status, review_notes: reviewNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeOff'] });
      setShowReviewModal(false);
      toast.success('Request reviewed');
    },
    onError: () => toast.error('Failed to review request'),
  });

  const createUnavailMutation = useMutation({
    mutationFn: () =>
      unavailability.create({
        day_of_week: Number(unavailForm.day_of_week),
        start_time: unavailForm.start_time,
        end_time: unavailForm.end_time,
        reason: unavailForm.reason || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unavailability'] });
      setShowUnavailModal(false);
      setUnavailForm({ day_of_week: '1', start_time: '00:00', end_time: '23:59', reason: '' });
      toast.success('Unavailability submitted');
    },
    onError: () => toast.error('Failed to submit unavailability'),
  });

  const reviewUnavailMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: RequestStatus }) =>
      unavailability.review(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unavailability'] });
      toast.success('Unavailability reviewed');
    },
    onError: () => toast.error('Failed to review'),
  });

  // Calendar data
  const calendarMonth = new Date();
  const approvedDates = useMemo(() => {
    if (!approvedRequests?.items) return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    approvedRequests.items.forEach((req) => {
      try {
        const days = eachDayOfInterval({
          start: parseISO(req.start_date),
          end: parseISO(req.end_date),
        });
        days.forEach((d) => {
          const key = format(d, 'yyyy-MM-dd');
          const name = req.employee_name ?? (req.user ? `${req.user.first_name} ${req.user.last_name.charAt(0)}.` : `Employee #${req.employee_id ?? req.user_id}`);
          const existing = map.get(key) || [];
          existing.push(name);
          map.set(key, existing);
        });
      } catch {
        // skip invalid date ranges
      }
    });
    return map;
  }, [approvedRequests]);

  const openReview = (request: TimeOffRequest) => {
    setReviewingRequest(request);
    setReviewNotes('');
    setShowReviewModal(true);
  };

  const tabs = [
    { id: 'requests' as const, label: 'My Requests' },
    { id: 'unavailability' as const, label: 'Unavailability' },
    { id: 'calendar' as const, label: 'Calendar' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Time Off</h1>
          <p className="page-subtitle">Request and manage time off.</p>
        </div>
        <div className="flex gap-2">
          <Button
            icon={<Plus className="h-4 w-4" />}
            onClick={() => setShowRequestModal(true)}
          >
            Request Time Off
          </Button>
          <Button
            variant="secondary"
            icon={<Ban className="h-4 w-4" />}
            onClick={() => setShowUnavailModal(true)}
          >
            Set Unavailability
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* My Requests Tab */}
      {activeTab === 'requests' && (
        <div className="space-y-6">
          <Card title="My Time Off Requests">
            {requestsLoading ? (
              <LoadingSpinner label="Loading requests..." />
            ) : myRequests?.items && myRequests.items.length > 0 ? (
              <div className="space-y-3">
                {myRequests.items.map((req) => (
                  <div
                    key={req.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-gray-200 p-4"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-900">
                          {format(parseISO(req.start_date), 'MMM d, yyyy')} -{' '}
                          {format(parseISO(req.end_date), 'MMM d, yyyy')}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">{req.reason}</p>
                      {req.review_notes && (
                        <p className="text-xs text-gray-400 mt-1 italic">
                          Manager notes: {req.review_notes}
                        </p>
                      )}
                    </div>
                    {getStatusBadge(req.status)}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Palmtree className="h-10 w-10" />}
                title="No time off requests"
                description="Submit a request to get started."
                action={
                  <Button size="sm" onClick={() => setShowRequestModal(true)}>
                    Request Time Off
                  </Button>
                }
              />
            )}
          </Card>

          {/* Manager: Pending Requests */}
          {isManager && (
            <Card title="Pending Requests (Manager)" className="border-amber-200">
              {pendingLoading ? (
                <LoadingSpinner label="Loading pending requests..." />
              ) : pendingRequests?.items && pendingRequests.items.length > 0 ? (
                <div className="space-y-3">
                  {pendingRequests.items.map((req) => (
                    <div
                      key={req.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900">
                          {req.employee_name ?? (req.user ? `${req.user.first_name} ${req.user.last_name}` : `Employee #${req.employee_id ?? req.user_id}`)}
                        </p>
                        <p className="text-sm text-gray-600">
                          {format(parseISO(req.start_date), 'MMM d')} -{' '}
                          {format(parseISO(req.end_date), 'MMM d, yyyy')}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">{req.reason}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          icon={<Check className="h-3.5 w-3.5" />}
                          onClick={() => {
                            setReviewingRequest(req);
                            setReviewNotes('');
                            reviewMutation.mutate('approved' as RequestStatus);
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          icon={<X className="h-3.5 w-3.5" />}
                          onClick={() => openReview(req)}
                        >
                          Deny
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No pending requests"
                  description="All time off requests have been reviewed."
                />
              )}
            </Card>
          )}
        </div>
      )}

      {/* Unavailability Tab */}
      {activeTab === 'unavailability' && (
        <div className="space-y-6">
          <Card title="My Recurring Unavailability">
            {myUnavailability && myUnavailability.length > 0 ? (
              <div className="space-y-3">
                {myUnavailability.map((ua) => (
                  <div
                    key={ua.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 p-4"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {DAY_NAMES[ua.day_of_week]}
                      </p>
                      <p className="text-xs text-gray-500">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {ua.start_time} - {ua.end_time}
                      </p>
                      {ua.reason && (
                        <p className="text-xs text-gray-400 mt-1">{ua.reason}</p>
                      )}
                    </div>
                    {getStatusBadge(ua.status)}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Ban className="h-10 w-10" />}
                title="No unavailability set"
                description="Set recurring times when you are unavailable."
                action={
                  <Button size="sm" onClick={() => setShowUnavailModal(true)}>
                    Set Unavailability
                  </Button>
                }
              />
            )}
          </Card>

          {/* Manager: Pending Unavailability */}
          {isManager && pendingUnavailability && pendingUnavailability.length > 0 && (
            <Card title="Pending Unavailability Requests">
              <div className="space-y-3">
                {pendingUnavailability.map((ua) => (
                  <div
                    key={ua.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {ua.employee_name ?? (ua.user ? `${ua.user.first_name} ${ua.user.last_name}` : `Employee #${ua.employee_id ?? ua.user_id}`)}
                      </p>
                      <p className="text-sm text-gray-600">
                        {DAY_NAMES[ua.day_of_week]} | {ua.start_time} - {ua.end_time}
                      </p>
                      {ua.reason && (
                        <p className="text-xs text-gray-400">{ua.reason}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        icon={<Check className="h-3.5 w-3.5" />}
                        onClick={() =>
                          reviewUnavailMutation.mutate({
                            id: ua.id,
                            status: 'approved' as RequestStatus,
                          })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<X className="h-3.5 w-3.5" />}
                        onClick={() =>
                          reviewUnavailMutation.mutate({
                            id: ua.id,
                            status: 'denied' as RequestStatus,
                          })
                        }
                      >
                        Deny
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Calendar Tab */}
      {activeTab === 'calendar' && (
        <Card title={format(calendarMonth, 'MMMM yyyy')}>
          <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden">
            {/* Day headers */}
            {DAY_NAMES_SHORT.map((d) => (
              <div key={d} className="bg-gray-50 py-2 text-center text-xs font-semibold text-gray-500">
                {d}
              </div>
            ))}
            {/* Calendar grid */}
            {(() => {
              const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
              const lastDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0);
              const startPad = firstDay.getDay();
              const cells = [];
              // Padding
              for (let i = 0; i < startPad; i++) {
                cells.push(
                  <div key={`pad-${i}`} className="bg-white p-2 min-h-[80px]" />,
                );
              }
              // Days
              for (let d = 1; d <= lastDay.getDate(); d++) {
                const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), d);
                const dateKey = format(date, 'yyyy-MM-dd');
                const names = approvedDates.get(dateKey) || [];
                const isToday =
                  date.toDateString() === new Date().toDateString();

                cells.push(
                  <div
                    key={dateKey}
                    className={`bg-white p-2 min-h-[80px] ${
                      isToday ? 'ring-2 ring-inset ring-primary' : ''
                    }`}
                  >
                    <p
                      className={`text-xs font-medium mb-1 ${
                        isToday ? 'text-primary font-bold' : 'text-gray-700'
                      }`}
                    >
                      {d}
                    </p>
                    {names.map((name, i) => (
                      <p
                        key={i}
                        className="text-[10px] text-red-600 bg-red-50 rounded px-1 py-0.5 mb-0.5 truncate"
                      >
                        {name}
                      </p>
                    ))}
                  </div>,
                );
              }
              return cells;
            })()}
          </div>
        </Card>
      )}

      {/* Request Time Off Modal */}
      <Modal
        open={showRequestModal}
        onClose={() => setShowRequestModal(false)}
        title="Request Time Off"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Start Date"
              type="date"
              value={requestForm.start_date}
              onChange={(e) => setRequestForm({ ...requestForm, start_date: e.target.value })}
            />
            <Input
              label="End Date"
              type="date"
              value={requestForm.end_date}
              onChange={(e) => setRequestForm({ ...requestForm, end_date: e.target.value })}
            />
          </div>
          <Input
            label="Reason"
            value={requestForm.reason}
            onChange={(e) => setRequestForm({ ...requestForm, reason: e.target.value })}
            placeholder="Why do you need time off?"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowRequestModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createRequestMutation.mutate()}
              loading={createRequestMutation.isPending}
              disabled={!requestForm.start_date || !requestForm.end_date || !requestForm.reason}
            >
              Submit Request
            </Button>
          </div>
        </div>
      </Modal>

      {/* Set Unavailability Modal */}
      <Modal
        open={showUnavailModal}
        onClose={() => setShowUnavailModal(false)}
        title="Set Recurring Unavailability"
      >
        <div className="space-y-4">
          <Select
            label="Day of Week"
            options={DAY_NAMES.map((name, i) => ({ value: i, label: name }))}
            value={unavailForm.day_of_week}
            onChange={(e) => setUnavailForm({ ...unavailForm, day_of_week: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="From"
              type="time"
              value={unavailForm.start_time}
              onChange={(e) => setUnavailForm({ ...unavailForm, start_time: e.target.value })}
            />
            <Input
              label="To"
              type="time"
              value={unavailForm.end_time}
              onChange={(e) => setUnavailForm({ ...unavailForm, end_time: e.target.value })}
            />
          </div>
          <Input
            label="Reason (optional)"
            value={unavailForm.reason}
            onChange={(e) => setUnavailForm({ ...unavailForm, reason: e.target.value })}
            placeholder="e.g., Classes, childcare..."
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowUnavailModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createUnavailMutation.mutate()}
              loading={createUnavailMutation.isPending}
            >
              Submit
            </Button>
          </div>
        </div>
      </Modal>

      {/* Review Modal */}
      <Modal
        open={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        title="Review Time Off Request"
      >
        {reviewingRequest && (
          <div className="space-y-4">
            <div className="rounded-lg bg-gray-50 p-3 text-sm">
              <p className="font-medium">
                {reviewingRequest.employee_name ?? (reviewingRequest.user ? `${reviewingRequest.user.first_name} ${reviewingRequest.user.last_name}` : `Employee #${reviewingRequest.employee_id ?? reviewingRequest.user_id}`)}
              </p>
              <p className="text-gray-600">
                {format(parseISO(reviewingRequest.start_date), 'MMM d')} -{' '}
                {format(parseISO(reviewingRequest.end_date), 'MMM d, yyyy')}
              </p>
              <p className="text-gray-500 mt-1">{reviewingRequest.reason}</p>
            </div>
            <Input
              label="Review Notes"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Optional notes for the employee..."
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowReviewModal(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => reviewMutation.mutate('denied' as RequestStatus)}
                loading={reviewMutation.isPending}
              >
                Deny
              </Button>
              <Button
                onClick={() => reviewMutation.mutate('approved' as RequestStatus)}
                loading={reviewMutation.isPending}
              >
                Approve
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
