import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Hand,
  Check,
  X,
  Plus,
  Clock,
  Calendar,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  shiftSwaps,
  shiftCoverage,
  schedules,
  users as usersApi,
} from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import type {
  ShiftSwapRequest,
  ShiftCoverageRequest,
  ScheduledShift,
  User,
  RequestStatus,
} from '@/types';
import { UserRole } from '@/types';

function formatShift(shift?: ScheduledShift) {
  if (!shift) return 'Unknown shift';
  return `${format(parseISO(shift.date), 'MMM d')} ${shift.start_time} - ${shift.end_time}`;
}

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

export function ShiftSwapsPage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();
  const isManager = currentUser?.role === UserRole.MANAGER || currentUser?.role === UserRole.OWNER;

  const [activeTab, setActiveTab] = useState<'swaps' | 'coverage'>('swaps');
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [showCoverageModal, setShowCoverageModal] = useState(false);
  const [swapPage, setSwapPage] = useState(1);
  const [coveragePage, setCoveragePage] = useState(1);

  // Swap form
  const [swapForm, setSwapForm] = useState({
    requester_shift_id: '',
    target_id: '',
    target_shift_id: '',
  });

  // Coverage form
  const [coverageForm, setCoverageForm] = useState({
    shift_id: '',
    reason: '',
  });

  // Queries
  const { data: swapsData, isLoading: swapsLoading } = useQuery({
    queryKey: ['shiftSwaps', swapPage],
    queryFn: () => shiftSwaps.list({ page: swapPage, per_page: 10 }),
  });

  const { data: coverageData, isLoading: coverageLoading } = useQuery({
    queryKey: ['shiftCoverage', coveragePage],
    queryFn: () => shiftCoverage.list({ page: coveragePage, per_page: 10 }),
  });

  const { data: pendingSwaps } = useQuery({
    queryKey: ['shiftSwaps', 'pending'],
    queryFn: () => shiftSwaps.list({ status: 'pending' as RequestStatus, per_page: 50 }),
    enabled: isManager,
  });

  const { data: pendingCoverage } = useQuery({
    queryKey: ['shiftCoverage', 'pending'],
    queryFn: () => shiftCoverage.list({ status: 'pending' as RequestStatus, per_page: 50 }),
    enabled: isManager,
  });

  // Load upcoming shifts for the current user
  const { data: myShifts } = useQuery({
    queryKey: ['myUpcomingShifts', currentUser?.id],
    queryFn: () => {
      const now = new Date();
      return schedules.listShifts({
        user_id: currentUser!.id,
        start_date: format(now, 'yyyy-MM-dd'),
        end_date: format(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
      });
    },
    enabled: !!currentUser,
  });

  // Load employees for swap target selection
  const { data: employeeList } = useQuery({
    queryKey: ['employees'],
    queryFn: () => usersApi.list({ per_page: 100 }),
  });

  // Load target's shifts when target is selected
  const { data: targetShifts } = useQuery({
    queryKey: ['targetShifts', swapForm.target_id],
    queryFn: () => {
      const now = new Date();
      return schedules.listShifts({
        user_id: Number(swapForm.target_id),
        start_date: format(now, 'yyyy-MM-dd'),
        end_date: format(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
      });
    },
    enabled: !!swapForm.target_id,
  });

  // Mutations
  const createSwapMutation = useMutation({
    mutationFn: () =>
      shiftSwaps.create({
        target_id: Number(swapForm.target_id),
        requester_shift_id: Number(swapForm.requester_shift_id),
        target_shift_id: Number(swapForm.target_shift_id),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shiftSwaps'] });
      setShowSwapModal(false);
      setSwapForm({ requester_shift_id: '', target_id: '', target_shift_id: '' });
      toast.success('Swap request submitted');
    },
    onError: () => toast.error('Failed to submit swap request'),
  });

  const reviewSwapMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: RequestStatus }) =>
      shiftSwaps.review(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shiftSwaps'] });
      toast.success('Swap reviewed');
    },
    onError: () => toast.error('Failed to review swap'),
  });

  const postCoverageMutation = useMutation({
    mutationFn: () =>
      shiftCoverage.post({
        shift_id: Number(coverageForm.shift_id),
        reason: coverageForm.reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shiftCoverage'] });
      setShowCoverageModal(false);
      setCoverageForm({ shift_id: '', reason: '' });
      toast.success('Shift posted for coverage');
    },
    onError: () => toast.error('Failed to post shift'),
  });

  const claimCoverageMutation = useMutation({
    mutationFn: (id: number) => shiftCoverage.claim(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shiftCoverage'] });
      toast.success('Shift claimed!');
    },
    onError: () => toast.error('Failed to claim shift'),
  });

  const reviewCoverageMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: RequestStatus }) =>
      shiftCoverage.review(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shiftCoverage'] });
      toast.success('Coverage reviewed');
    },
    onError: () => toast.error('Failed to review coverage'),
  });

  const employees = employeeList?.items?.filter((u: User) => u.id !== currentUser?.id) || [];

  const tabs = [
    { id: 'swaps' as const, label: 'Shift Swaps', icon: <ArrowLeftRight className="h-4 w-4" /> },
    { id: 'coverage' as const, label: 'Coverage', icon: <Hand className="h-4 w-4" /> },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Shift Swaps & Coverage</h1>
          <p className="page-subtitle">Swap shifts or find coverage for your shifts.</p>
        </div>
        <div className="flex gap-2">
          <Button
            icon={<ArrowLeftRight className="h-4 w-4" />}
            onClick={() => {
              setSwapForm({ requester_shift_id: '', target_id: '', target_shift_id: '' });
              setShowSwapModal(true);
            }}
          >
            Request Swap
          </Button>
          <Button
            variant="secondary"
            icon={<Hand className="h-4 w-4" />}
            onClick={() => {
              setCoverageForm({ shift_id: '', reason: '' });
              setShowCoverageModal(true);
            }}
          >
            Post for Coverage
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Swaps Tab */}
      {activeTab === 'swaps' && (
        <div className="space-y-6">
          {/* My swap requests */}
          <Card title="Swap Requests">
            {swapsLoading ? (
              <LoadingSpinner label="Loading swaps..." />
            ) : swapsData?.items && swapsData.items.length > 0 ? (
              <div className="space-y-3">
                {swapsData.items.map((swap) => (
                  <div
                    key={swap.id}
                    className="rounded-lg border border-gray-200 p-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          {/* Requester side */}
                          <div className="text-sm">
                            <p className="font-medium text-gray-900">
                              {swap.requester
                                ? `${swap.requester.first_name} ${swap.requester.last_name}`
                                : `Employee #${swap.requester_id}`}
                            </p>
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatShift(swap.requester_shift)}
                            </p>
                          </div>

                          <ArrowLeftRight className="h-4 w-4 text-gray-400 shrink-0" />

                          {/* Target side */}
                          <div className="text-sm">
                            <p className="font-medium text-gray-900">
                              {swap.target
                                ? `${swap.target.first_name} ${swap.target.last_name}`
                                : `Employee #${swap.target_id}`}
                            </p>
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatShift(swap.target_shift)}
                            </p>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                          Requested {format(parseISO(swap.created_at), 'MMM d, h:mm a')}
                        </p>
                      </div>
                      {getStatusBadge(swap.status)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<ArrowLeftRight className="h-10 w-10" />}
                title="No swap requests"
                description="Request a shift swap to trade shifts with a coworker."
                action={
                  <Button size="sm" onClick={() => setShowSwapModal(true)}>
                    Request Swap
                  </Button>
                }
              />
            )}
          </Card>

          {/* Manager: Pending Swaps */}
          {isManager && pendingSwaps?.items && pendingSwaps.items.length > 0 && (
            <Card title="Pending Swap Approvals" className="border-amber-200">
              <div className="space-y-3">
                {pendingSwaps.items.map((swap) => (
                  <div
                    key={swap.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4"
                  >
                    <div className="flex-1 text-sm">
                      <p>
                        <span className="font-semibold">
                          {swap.requester
                            ? `${swap.requester.first_name} ${swap.requester.last_name}`
                            : `#${swap.requester_id}`}
                        </span>
                        {' '}wants to swap with{' '}
                        <span className="font-semibold">
                          {swap.target
                            ? `${swap.target.first_name} ${swap.target.last_name}`
                            : `#${swap.target_id}`}
                        </span>
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {formatShift(swap.requester_shift)} &harr; {formatShift(swap.target_shift)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        icon={<Check className="h-3.5 w-3.5" />}
                        onClick={() =>
                          reviewSwapMutation.mutate({
                            id: swap.id,
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
                          reviewSwapMutation.mutate({
                            id: swap.id,
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

      {/* Coverage Tab */}
      {activeTab === 'coverage' && (
        <div className="space-y-6">
          {/* Available shifts for coverage */}
          <Card title="Available Shifts for Coverage">
            {coverageLoading ? (
              <LoadingSpinner label="Loading coverage requests..." />
            ) : coverageData?.items && coverageData.items.length > 0 ? (
              <div className="space-y-3">
                {coverageData.items.map((cov) => (
                  <div
                    key={cov.id}
                    className="rounded-lg border border-gray-200 p-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Calendar className="h-4 w-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-900">
                            {formatShift(cov.shift)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">
                          Posted by:{' '}
                          {cov.poster
                            ? `${cov.poster.first_name} ${cov.poster.last_name}`
                            : `Employee #${cov.posted_by}`}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">{cov.reason}</p>
                        {cov.claimer && (
                          <p className="text-xs text-green-600 mt-1">
                            Claimed by: {cov.claimer.first_name} {cov.claimer.last_name}
                          </p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          Posted {format(parseISO(cov.created_at), 'MMM d, h:mm a')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(cov.status)}
                        {cov.status === 'pending' &&
                          !cov.claimed_by &&
                          cov.posted_by !== currentUser?.id && (
                            <Button
                              size="sm"
                              icon={<Hand className="h-3.5 w-3.5" />}
                              onClick={() => claimCoverageMutation.mutate(cov.id)}
                              loading={claimCoverageMutation.isPending}
                            >
                              Claim
                            </Button>
                          )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Hand className="h-10 w-10" />}
                title="No coverage requests"
                description="Post a shift for coverage or check back for available shifts."
                action={
                  <Button size="sm" onClick={() => setShowCoverageModal(true)}>
                    Post for Coverage
                  </Button>
                }
              />
            )}
          </Card>

          {/* Manager: Pending Coverage */}
          {isManager && pendingCoverage?.items && pendingCoverage.items.length > 0 && (
            <Card title="Coverage Approvals" className="border-amber-200">
              <div className="space-y-3">
                {pendingCoverage.items
                  .filter((c) => c.claimed_by)
                  .map((cov) => (
                    <div
                      key={cov.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4"
                    >
                      <div className="flex-1 text-sm">
                        <p>
                          <span className="font-semibold">
                            {cov.claimer
                              ? `${cov.claimer.first_name} ${cov.claimer.last_name}`
                              : `#${cov.claimed_by}`}
                          </span>
                          {' '}wants to cover{' '}
                          <span className="font-semibold">
                            {cov.poster
                              ? `${cov.poster.first_name} ${cov.poster.last_name}`
                              : `#${cov.posted_by}`}
                          </span>
                          {"'s shift"}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">{formatShift(cov.shift)}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          icon={<Check className="h-3.5 w-3.5" />}
                          onClick={() =>
                            reviewCoverageMutation.mutate({
                              id: cov.id,
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
                            reviewCoverageMutation.mutate({
                              id: cov.id,
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

      {/* Swap Request Modal */}
      <Modal
        open={showSwapModal}
        onClose={() => setShowSwapModal(false)}
        title="Request Shift Swap"
        size="lg"
      >
        <div className="space-y-4">
          <Select
            label="Your Shift"
            options={
              myShifts?.shifts?.map((s: ScheduledShift) => ({
                value: s.id,
                label: `${format(parseISO(s.date), 'MMM d (EEE)')} ${s.start_time} - ${s.end_time}${s.role_label ? ` (${s.role_label})` : ''}`,
              })) || []
            }
            value={swapForm.requester_shift_id}
            onChange={(e) => setSwapForm({ ...swapForm, requester_shift_id: e.target.value })}
            placeholder="Select your shift to swap"
          />
          <Select
            label="Swap With (Employee)"
            options={employees.map((u: User) => ({
              value: u.id,
              label: `${u.first_name} ${u.last_name}`,
            }))}
            value={swapForm.target_id}
            onChange={(e) =>
              setSwapForm({ ...swapForm, target_id: e.target.value, target_shift_id: '' })
            }
            placeholder="Select employee"
          />
          {swapForm.target_id && (
            <Select
              label="Their Shift"
              options={
                targetShifts?.shifts?.map((s: ScheduledShift) => ({
                  value: s.id,
                  label: `${format(parseISO(s.date), 'MMM d (EEE)')} ${s.start_time} - ${s.end_time}${s.role_label ? ` (${s.role_label})` : ''}`,
                })) || []
              }
              value={swapForm.target_shift_id}
              onChange={(e) => setSwapForm({ ...swapForm, target_shift_id: e.target.value })}
              placeholder="Select their shift"
            />
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowSwapModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createSwapMutation.mutate()}
              loading={createSwapMutation.isPending}
              disabled={
                !swapForm.requester_shift_id ||
                !swapForm.target_id ||
                !swapForm.target_shift_id
              }
            >
              Submit Swap Request
            </Button>
          </div>
        </div>
      </Modal>

      {/* Post for Coverage Modal */}
      <Modal
        open={showCoverageModal}
        onClose={() => setShowCoverageModal(false)}
        title="Post Shift for Coverage"
      >
        <div className="space-y-4">
          <Select
            label="Select Shift"
            options={
              myShifts?.shifts?.map((s: ScheduledShift) => ({
                value: s.id,
                label: `${format(parseISO(s.date), 'MMM d (EEE)')} ${s.start_time} - ${s.end_time}`,
              })) || []
            }
            value={coverageForm.shift_id}
            onChange={(e) => setCoverageForm({ ...coverageForm, shift_id: e.target.value })}
            placeholder="Select shift to post"
          />
          <Input
            label="Reason"
            value={coverageForm.reason}
            onChange={(e) => setCoverageForm({ ...coverageForm, reason: e.target.value })}
            placeholder="Why do you need coverage?"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowCoverageModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => postCoverageMutation.mutate()}
              loading={postCoverageMutation.isPending}
              disabled={!coverageForm.shift_id || !coverageForm.reason}
            >
              Post for Coverage
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
