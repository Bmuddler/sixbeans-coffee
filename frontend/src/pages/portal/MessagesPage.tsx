import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Send,
  Bell,
  MapPin,
  Plus,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  Users,
  Check,
  CheckCheck,
  Eye,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import {
  messages as messagesApi,
  locations as locationsApi,
  users as usersApi,
} from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { UserRole, type Message, type User, type Location } from '@/types';
import toast from 'react-hot-toast';

function formatTimestamp(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

type Tab = 'messages' | 'announcements';
type SendMode = 'location' | 'direct';

export function MessagesPage() {
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('messages');
  const [messageBody, setMessageBody] = useState('');
  const [selectedLocationFilter, setSelectedLocationFilter] = useState<number | undefined>();
  const [sendMode, setSendMode] = useState<SendMode>('location');
  const [sendToLocationId, setSendToLocationId] = useState<number | undefined>();
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<number>>(new Set());
  const [collapsedShops, setCollapsedShops] = useState<Set<number>>(new Set());
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [announcementSubject, setAnnouncementSubject] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [announcementLocationId, setAnnouncementLocationId] = useState<string>('');
  const [showReadReceipts, setShowReadReceipts] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isOwner = currentUser?.role === UserRole.OWNER;
  const isManager = currentUser?.role === UserRole.MANAGER;
  const isManagerOrOwner = isOwner || isManager;

  const { data: allLocations } = useQuery({ queryKey: ['locations'], queryFn: locationsApi.list });
  const { data: teamData } = useQuery({ queryKey: ['users-for-messages'], queryFn: () => usersApi.list({ per_page: 100 }) });
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['messages', selectedLocationFilter],
    queryFn: () => messagesApi.list({ per_page: 50, location_id: selectedLocationFilter }),
    refetchInterval: 10000,
  });
  const { data: announcements, isLoading: announcementsLoading } = useQuery({
    queryKey: ['announcements', selectedLocationFilter],
    queryFn: () => messagesApi.getAnnouncements(selectedLocationFilter ? { location_id: selectedLocationFilter } : undefined),
    refetchInterval: 30000,
  });
  const { data: unreadData } = useQuery({
    queryKey: ['unread-count'],
    queryFn: messagesApi.getUnreadCount,
    refetchInterval: 15000,
  });

  const sendMessageMutation = useMutation({
    mutationFn: (data: { body: string; location_id?: number; recipient_ids?: number[] }) => messagesApi.send(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['unread-count'] });
      setMessageBody('');
      toast.success('Message sent!');
    },
    onError: () => toast.error('Failed to send message.'),
  });

  const sendAnnouncementMutation = useMutation({
    mutationFn: (data: { location_id?: number; subject?: string; body: string }) => messagesApi.sendAnnouncement(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      setShowAnnouncementModal(false);
      setAnnouncementSubject('');
      setAnnouncementBody('');
      setAnnouncementLocationId('');
      toast.success('Announcement posted!');
    },
    onError: () => toast.error('Failed to post announcement.'),
  });

  const markReadMutation = useMutation({
    mutationFn: (ids: number[]) => messagesApi.markRead(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  // Auto-scroll and mark as read
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    const items = messagesData?.items ?? [];
    const unreadIds = items
      .filter((m) => m.recipients?.some((r) => r.user_id === currentUser?.id && !r.read_at))
      .map((m) => m.id);
    if (unreadIds.length > 0) markReadMutation.mutate(unreadIds);
  }, [messagesData]);

  // Group team by location + owners/managers without locations
  const teamByLocation = useMemo(() => {
    const allTeam = teamData?.items ?? [];
    const map = new Map<number, { location: Location; members: User[] }>();
    allLocations?.forEach((loc) => map.set(loc.id, { location: loc, members: [] }));

    const isEmployee = currentUser?.role === UserRole.EMPLOYEE;
    const myLocationIds = currentUser?.location_ids ?? [];
    const ownersAndManagers: User[] = [];

    allTeam.forEach((member) => {
      if (member.id === currentUser?.id) return;
      const memberLocs = member.location_ids ?? [];
      const isMgrOrOwner = member.role === 'manager' || member.role === 'owner';

      if (isEmployee) {
        const isCoworker = memberLocs.some((lid) => myLocationIds.includes(lid));
        if (!isCoworker && !isMgrOrOwner) return;
      }

      // Owners/managers with no locations go in a separate group
      if (memberLocs.length === 0 && isMgrOrOwner) {
        ownersAndManagers.push(member);
        return;
      }

      memberLocs.forEach((locId) => {
        const group = map.get(locId);
        if (group && !group.members.find((m) => m.id === member.id)) {
          group.members.push(member);
        }
      });
    });
    return { byLocation: map, ownersAndManagers };
  }, [teamData, allLocations, currentUser]);

  // Selection helpers
  const toggleRecipient = (id: number) => {
    setSendMode('direct');
    setSelectedRecipientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectShop = (locId: number) => {
    const group = teamByLocation.byLocation.get(locId);
    if (!group) return;
    const ids = group.members.map((m) => m.id);
    const allSelected = ids.every((id) => selectedRecipientIds.has(id));
    setSendMode('direct');
    setSelectedRecipientIds((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const selectLocationForBroadcast = (locId: number) => {
    setSendMode('location');
    setSendToLocationId(locId);
    setSelectedRecipientIds(new Set());
    setSelectedLocationFilter(locId);
  };

  const selectCompanyWide = () => {
    setSendMode('location');
    setSendToLocationId(undefined);
    setSelectedRecipientIds(new Set());
    setSelectedLocationFilter(undefined);
  };

  const handleSendMessage = () => {
    if (!messageBody.trim()) return;
    if (sendMode === 'direct' && selectedRecipientIds.size > 0) {
      sendMessageMutation.mutate({ body: messageBody.trim(), recipient_ids: Array.from(selectedRecipientIds) });
    } else {
      sendMessageMutation.mutate({ body: messageBody.trim(), location_id: sendToLocationId });
    }
  };

  const handleSendAnnouncement = () => {
    if (!announcementBody.trim()) return;
    sendAnnouncementMutation.mutate({
      location_id: announcementLocationId ? parseInt(announcementLocationId, 10) : undefined,
      subject: announcementSubject.trim() || undefined,
      body: announcementBody.trim(),
    });
  };

  const toggleShopCollapse = (locId: number) => {
    setCollapsedShops((prev) => { const next = new Set(prev); if (next.has(locId)) next.delete(locId); else next.add(locId); return next; });
  };

  const allMessages = messagesData?.items ?? [];
  const displayMessages = allMessages.filter((m) => !m.is_announcement);
  const unreadCount = unreadData?.unread_count ?? 0;
  const locationOptions = allLocations?.map((loc) => ({ value: loc.id.toString(), label: loc.name })) ?? [];

  // Build "sending to" label
  const sendingToLabel = useMemo(() => {
    if (sendMode === 'direct' && selectedRecipientIds.size > 0) {
      const allTeam = teamData?.items ?? [];
      const names = Array.from(selectedRecipientIds)
        .map((id) => allTeam.find((u) => u.id === id))
        .filter(Boolean)
        .map((u) => `${u!.first_name} ${u!.last_name?.[0] ?? ''}.`);
      if (names.length <= 3) return names.join(', ');
      return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
    }
    if (sendToLocationId) return allLocations?.find((l) => l.id === sendToLocationId)?.name ?? 'Location';
    return 'Company-wide';
  }, [sendMode, selectedRecipientIds, sendToLocationId, teamData, allLocations]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Messages</h1>
          <p className="page-subtitle">Team messaging and announcements.</p>
        </div>
        {isManagerOrOwner && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowAnnouncementModal(true)}>New Announcement</Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'messages' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`} onClick={() => setActiveTab('messages')}>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />Messages
            {unreadCount > 0 && <span className="inline-flex items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-medium text-white">{unreadCount}</span>}
          </div>
        </button>
        <button className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'announcements' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`} onClick={() => setActiveTab('announcements')}>
          <div className="flex items-center gap-2"><Bell className="h-4 w-4" />Announcements</div>
        </button>
      </div>

      {/* Messages Tab */}
      {activeTab === 'messages' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card padding={false}>
              {/* Filter bar */}
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200 flex-wrap">
                <span className="text-xs text-gray-500">Filter:</span>
                <button onClick={() => setSelectedLocationFilter(undefined)} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${!selectedLocationFilter ? 'bg-primary text-white' : 'bg-white text-gray-600 border border-gray-300 hover:border-primary'}`}>All</button>
                {allLocations?.map((loc) => (
                  <button key={loc.id} onClick={() => setSelectedLocationFilter(loc.id)} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${selectedLocationFilter === loc.id ? 'bg-primary text-white' : 'bg-white text-gray-600 border border-gray-300 hover:border-primary'}`}>
                    {loc.name.replace('Six Beans - ', '')}
                  </button>
                ))}
              </div>

              {/* Messages */}
              <div className="h-[420px] overflow-y-auto">
                {messagesLoading ? (
                  <LoadingSpinner className="py-20" label="Loading messages..." />
                ) : displayMessages.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {displayMessages.map((msg) => {
                      const isMine = msg.sender_id === currentUser?.id;
                      const senderName = msg.sender_name ?? 'Unknown';
                      const initials = senderName.split(' ').map((n: string) => n[0]).join('').slice(0, 2);
                      const locName = allLocations?.find((l) => l.id === msg.location_id)?.name?.replace('Six Beans - ', '');
                      const isDirectMsg = msg.is_direct;
                      const readCount = msg.read_count ?? 0;
                      const totalRecipients = msg.total_recipients ?? 0;
                      const allRead = totalRecipients > 0 && readCount >= totalRecipients;

                      return (
                        <div key={msg.id} className={`px-4 py-3 ${isMine ? 'bg-primary/5' : ''}`}>
                          <div className="flex items-start gap-3">
                            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white flex-shrink-0 ${isMine ? 'bg-primary' : 'bg-gray-400'}`}>{initials}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium text-gray-900">{senderName}{isMine && <span className="text-xs text-gray-400 ml-1">(you)</span>}</p>
                                  {isDirectMsg && <Badge variant="info">DM</Badge>}
                                  {locName && !isDirectMsg && <Badge variant="pending">{locName}</Badge>}
                                  {!msg.location_id && !isDirectMsg && <Badge variant="approved">All</Badge>}
                                </div>
                                <div className="flex items-center gap-2">
                                  {isMine && totalRecipients > 0 && (
                                    <button
                                      onClick={() => setShowReadReceipts(showReadReceipts === msg.id ? null : msg.id)}
                                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                                      title={`${readCount}/${totalRecipients} read`}
                                    >
                                      {allRead ? <CheckCheck className="h-3.5 w-3.5 text-blue-500" /> : <Check className="h-3.5 w-3.5" />}
                                      <span>{readCount}/{totalRecipients}</span>
                                    </button>
                                  )}
                                  <span className="text-xs text-gray-400">{formatTimestamp(msg.created_at)}</span>
                                </div>
                              </div>
                              {isDirectMsg && msg.recipients && msg.recipients.length > 0 && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                  To: {msg.recipients.map((r) => r.user_name ?? `User #${r.user_id}`).join(', ')}
                                </p>
                              )}
                              <p className="text-sm text-gray-600 mt-1">{msg.content ?? msg.body}</p>

                              {/* Read receipt details */}
                              {showReadReceipts === msg.id && msg.recipients && (
                                <div className="mt-2 p-2 rounded-lg bg-gray-50 border border-gray-200">
                                  <p className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1"><Eye className="h-3 w-3" /> Read receipts</p>
                                  <div className="space-y-1">
                                    {msg.recipients.map((r) => (
                                      <div key={r.user_id} className="flex items-center justify-between text-xs">
                                        <span className="text-gray-700">{r.user_name ?? `User #${r.user_id}`}</span>
                                        {r.read_at ? (
                                          <span className="text-blue-500 flex items-center gap-1"><CheckCheck className="h-3 w-3" />{formatTimestamp(r.read_at)}</span>
                                        ) : (
                                          <span className="text-gray-400">Not seen</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                ) : (
                  <EmptyState icon={<MessageSquare className="h-12 w-12" />} title="No Messages" description="Select recipients and send a message to get started." />
                )}
              </div>

              {/* Send bar */}
              <div className="border-t border-gray-200 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-gray-500">To:</span>
                  <span className="text-xs font-medium text-primary">{sendingToLabel}</span>
                  {selectedRecipientIds.size > 0 && (
                    <button onClick={() => { setSelectedRecipientIds(new Set()); setSendMode('location'); }} className="text-xs text-gray-400 hover:text-gray-600 underline">clear</button>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                    placeholder="Type a message..."
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <Button icon={<Send className="h-4 w-4" />} onClick={handleSendMessage} loading={sendMessageMutation.isPending} disabled={!messageBody.trim()}>Send</Button>
                </div>
              </div>
            </Card>
          </div>

          {/* Sidebar */}
          <div>
            <Card title="Send To" padding={false}>
              <div className="max-h-[530px] overflow-y-auto">
                {/* Company-wide */}
                <button onClick={selectCompanyWide} className={`flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 ${sendMode === 'location' && !sendToLocationId ? 'bg-primary/5' : ''}`}>
                  <Users className="h-4 w-4 text-primary" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">Company-wide</p>
                    <p className="text-xs text-gray-500">All locations</p>
                  </div>
                </button>

                {/* Owners & managers without a location */}
                {teamByLocation.ownersAndManagers.length > 0 && (
                  <div className="border-b border-gray-100">
                    <div className="px-4 py-2 bg-amber-50/50">
                      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Owners & Management</p>
                    </div>
                    {teamByLocation.ownersAndManagers.map((member) => {
                      const isSelected = selectedRecipientIds.has(member.id);
                      return (
                        <button
                          key={member.id}
                          onClick={() => toggleRecipient(member.id)}
                          className={`flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                        >
                          {isSelected ? <CheckSquare className="h-3.5 w-3.5 text-primary flex-shrink-0" /> : <Square className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />}
                          <div className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white bg-primary flex-shrink-0">
                            {member.first_name[0]}{member.last_name?.[0] ?? ''}
                          </div>
                          <span className="text-sm text-gray-700">{member.first_name} {member.last_name}</span>
                          <span className="text-[10px] text-primary font-medium ml-auto">{member.role === 'owner' ? 'OWNER' : 'MGR'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Shops with employees */}
                {Array.from(teamByLocation.byLocation.entries()).map(([locId, { location, members }]) => {
                  if (members.length === 0) return null;
                  const isCollapsed = collapsedShops.has(locId);
                  const allShopSelected = members.every((m) => selectedRecipientIds.has(m.id));
                  const someShopSelected = members.some((m) => selectedRecipientIds.has(m.id));
                  const isLocActive = sendMode === 'location' && sendToLocationId === locId;

                  return (
                    <div key={locId} className={isLocActive ? 'bg-primary/5' : ''}>
                      <div className="flex items-center border-b border-gray-100">
                        {/* Collapse toggle */}
                        <button onClick={() => toggleShopCollapse(locId)} className="p-2 text-gray-400 hover:text-gray-600">
                          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>

                        {/* Select all in shop */}
                        <button onClick={() => selectShop(locId)} className="p-1 text-gray-400 hover:text-primary" title="Select all at this location">
                          {allShopSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : someShopSelected ? <CheckSquare className="h-4 w-4 text-primary/50" /> : <Square className="h-4 w-4" />}
                        </button>

                        {/* Location name - click to broadcast to location */}
                        <button onClick={() => selectLocationForBroadcast(locId)} className="flex items-center gap-2 flex-1 py-2.5 pr-4 text-left hover:bg-gray-50 transition-colors">
                          <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
                          <span className="text-sm font-semibold text-gray-900 truncate">{location.name.replace('Six Beans - ', '')}</span>
                          <Badge variant="info">{members.length}</Badge>
                        </button>
                      </div>

                      {!isCollapsed && (
                        <div className="pl-4">
                          {members.map((member) => {
                            const isSelected = selectedRecipientIds.has(member.id);
                            return (
                              <button
                                key={member.id}
                                onClick={() => toggleRecipient(member.id)}
                                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-gray-50 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                              >
                                {isSelected ? <CheckSquare className="h-3.5 w-3.5 text-primary flex-shrink-0" /> : <Square className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />}
                                <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white flex-shrink-0 ${member.role === 'manager' ? 'bg-amber-500' : member.role === 'owner' ? 'bg-primary' : 'bg-gray-400'}`}>
                                  {member.first_name[0]}{member.last_name?.[0] ?? ''}
                                </div>
                                <span className="text-xs text-gray-700 truncate">{member.first_name} {member.last_name}</span>
                                {member.role === 'manager' && <span className="text-[10px] text-amber-600 font-medium ml-auto">MGR</span>}
                                {member.role === 'owner' && <span className="text-[10px] text-primary font-medium ml-auto">OWNER</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Announcements Tab */}
      {activeTab === 'announcements' && (
        <div>
          {isManagerOrOwner && locationOptions.length > 0 && (
            <div className="mb-4 flex items-center gap-3">
              <MapPin className="h-4 w-4 text-gray-400" />
              <Select options={[{ value: '', label: 'All Locations' }, ...locationOptions]} value={selectedLocationFilter?.toString() ?? ''} onChange={(e) => setSelectedLocationFilter(e.target.value ? parseInt(e.target.value, 10) : undefined)} className="w-48" />
            </div>
          )}
          {announcementsLoading ? (
            <LoadingSpinner className="py-20" label="Loading announcements..." />
          ) : announcements && announcements.length > 0 ? (
            <div className="space-y-4">
              {announcements.map((a: any) => (
                <Card key={a.id}>
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 flex-shrink-0"><Bell className="h-5 w-5 text-yellow-600" /></div>
                    <div className="flex-1">
                      {a.subject && <h3 className="text-base font-semibold text-gray-900">{a.subject}</h3>}
                      <p className="text-sm text-gray-600 mt-1">{a.content ?? a.body}</p>
                      <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
                        <span>{a.sender_name ?? 'System'}</span>
                        <span>·</span>
                        <span>{formatTimestamp(a.created_at)}</span>
                        {a.location_id && (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{allLocations?.find((l) => l.id === a.location_id)?.name ?? `Location #${a.location_id}`}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card><EmptyState icon={<Bell className="h-12 w-12" />} title="No Announcements" description="There are no announcements at this time." /></Card>
          )}
        </div>
      )}

      {/* Announcement Modal */}
      <Modal open={showAnnouncementModal} onClose={() => setShowAnnouncementModal(false)} title="Post Announcement">
        <div className="space-y-4">
          <Input label="Subject" value={announcementSubject} onChange={(e) => setAnnouncementSubject(e.target.value)} placeholder="Announcement title (optional)" />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Message</label>
            <textarea value={announcementBody} onChange={(e) => setAnnouncementBody(e.target.value)} placeholder="Write your announcement..." rows={4} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <Select label="Location (optional)" options={[{ value: '', label: 'All Locations (company-wide)' }, ...locationOptions]} value={announcementLocationId} onChange={(e) => setAnnouncementLocationId(e.target.value)} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowAnnouncementModal(false)}>Cancel</Button>
            <Button onClick={handleSendAnnouncement} loading={sendAnnouncementMutation.isPending} disabled={!announcementBody.trim()}>Post Announcement</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
