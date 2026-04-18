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

export function MessagesPage() {
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('messages');
  const [messageBody, setMessageBody] = useState('');
  const [selectedLocationFilter, setSelectedLocationFilter] = useState<number | undefined>();
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [announcementSubject, setAnnouncementSubject] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [announcementLocationId, setAnnouncementLocationId] = useState<string>('');
  const [collapsedShops, setCollapsedShops] = useState<Set<number>>(new Set());
  const [sendToLocationId, setSendToLocationId] = useState<number | undefined>();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isOwner = currentUser?.role === UserRole.OWNER;
  const isManager = currentUser?.role === UserRole.MANAGER;
  const isManagerOrOwner = isOwner || isManager;

  const { data: allLocations } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsApi.list,
  });

  const { data: teamData } = useQuery({
    queryKey: ['users-for-messages'],
    queryFn: () => usersApi.list({ per_page: 100 }),
    enabled: isManagerOrOwner,
  });

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['messages', selectedLocationFilter],
    queryFn: () => messagesApi.list({ per_page: 50, location_id: selectedLocationFilter }),
    refetchInterval: 15000,
  });

  const { data: announcements, isLoading: announcementsLoading } = useQuery({
    queryKey: ['announcements', selectedLocationFilter],
    queryFn: () => messagesApi.getAnnouncements(selectedLocationFilter ? { location_id: selectedLocationFilter } : undefined),
    refetchInterval: 30000,
  });

  const sendMessageMutation = useMutation({
    mutationFn: (data: { body: string; location_id?: number }) => messagesApi.send(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesData]);

  const handleSendMessage = () => {
    if (!messageBody.trim()) return;
    sendMessageMutation.mutate({
      body: messageBody.trim(),
      location_id: sendToLocationId,
    });
  };

  const handleSendAnnouncement = () => {
    if (!announcementBody.trim()) return;
    sendAnnouncementMutation.mutate({
      location_id: announcementLocationId ? parseInt(announcementLocationId, 10) : undefined,
      subject: announcementSubject.trim() || undefined,
      body: announcementBody.trim(),
    });
  };

  // Group team members by location for sidebar
  const teamByLocation = useMemo(() => {
    const allTeam = teamData?.items ?? [];
    const map = new Map<number, { location: Location; members: User[] }>();

    allLocations?.forEach((loc) => {
      map.set(loc.id, { location: loc, members: [] });
    });

    // For employees: only show their own location's coworkers + managers + owners
    const isEmployee = currentUser?.role === UserRole.EMPLOYEE;
    const myLocationIds = currentUser?.location_ids ?? [];

    allTeam.forEach((member) => {
      if (member.id === currentUser?.id) return;

      const memberLocs = member.location_ids ?? [];
      if (isEmployee) {
        // Employees only see: coworkers at same location, managers, owners
        const isCoworker = memberLocs.some((lid) => myLocationIds.includes(lid));
        const isManagerOrOwnerMember = member.role === 'manager' || member.role === 'owner';
        if (!isCoworker && !isManagerOrOwnerMember) return;
      }

      if (memberLocs.length === 0) return;
      memberLocs.forEach((locId) => {
        const group = map.get(locId);
        if (group && !group.members.find((m) => m.id === member.id)) {
          group.members.push(member);
        }
      });
    });

    return map;
  }, [teamData, allLocations, currentUser]);

  const toggleShopCollapse = (locId: number) => {
    setCollapsedShops((prev) => {
      const next = new Set(prev);
      if (next.has(locId)) next.delete(locId);
      else next.add(locId);
      return next;
    });
  };

  const selectShopForMessage = (locId: number) => {
    setSendToLocationId(locId);
  };

  const allMessages = messagesData?.items ?? [];
  const displayMessages = allMessages.filter((m) => !m.is_announcement);

  const locationOptions = allLocations?.map((loc) => ({ value: loc.id.toString(), label: loc.name })) ?? [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Messages</h1>
          <p className="page-subtitle">Team messaging and announcements.</p>
        </div>
        {isManagerOrOwner && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowAnnouncementModal(true)}>
            New Announcement
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'messages' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('messages')}
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Messages
          </div>
        </button>
        <button
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'announcements' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('announcements')}
        >
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Announcements
          </div>
        </button>
      </div>

      {/* Messages Tab */}
      {activeTab === 'messages' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Message List */}
          <div className="lg:col-span-2">
            <Card padding={false}>
              {/* Location filter bar */}
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
                <span className="text-xs text-gray-500">Viewing:</span>
                <div className="flex gap-1 flex-wrap">
                  <button
                    onClick={() => { setSelectedLocationFilter(undefined); setSendToLocationId(undefined); }}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${!selectedLocationFilter ? 'bg-primary text-white' : 'bg-white text-gray-600 border border-gray-300 hover:border-primary'}`}
                  >
                    All
                  </button>
                  {allLocations?.map((loc) => (
                    <button
                      key={loc.id}
                      onClick={() => { setSelectedLocationFilter(loc.id); setSendToLocationId(loc.id); }}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${selectedLocationFilter === loc.id ? 'bg-primary text-white' : 'bg-white text-gray-600 border border-gray-300 hover:border-primary'}`}
                    >
                      {loc.name.replace('Six Beans - ', '')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-[450px] overflow-y-auto">
                {messagesLoading ? (
                  <LoadingSpinner className="py-20" label="Loading messages..." />
                ) : displayMessages.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {displayMessages.map((msg) => {
                      const isMine = msg.sender_id === currentUser?.id;
                      const senderName = msg.sender_name ?? 'Unknown';
                      const initials = senderName.split(' ').map((n: string) => n[0]).join('').slice(0, 2);
                      const locName = allLocations?.find((l) => l.id === msg.location_id)?.name?.replace('Six Beans - ', '');
                      return (
                        <div key={msg.id} className={`px-4 py-3 ${isMine ? 'bg-primary/5' : ''}`}>
                          <div className="flex items-start gap-3">
                            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white flex-shrink-0 ${isMine ? 'bg-primary' : 'bg-gray-400'}`}>
                              {initials}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-gray-900">{senderName}{isMine && <span className="text-xs text-gray-400 ml-1">(you)</span>}</p>
                                  {locName && <Badge variant="info">{locName}</Badge>}
                                </div>
                                <span className="text-xs text-gray-400">{formatTimestamp(msg.created_at)}</span>
                              </div>
                              <p className="text-sm text-gray-600 mt-1">{msg.content ?? msg.body}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                ) : (
                  <EmptyState icon={<MessageSquare className="h-12 w-12" />} title="No Messages" description="Send a message to get started." />
                )}
              </div>

              {/* Message Input */}
              <div className="border-t border-gray-200 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-gray-500">Sending to:</span>
                  <span className="text-xs font-medium text-gray-700">
                    {sendToLocationId ? allLocations?.find((l) => l.id === sendToLocationId)?.name : 'Company-wide'}
                  </span>
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
                  <Button icon={<Send className="h-4 w-4" />} onClick={handleSendMessage} loading={sendMessageMutation.isPending} disabled={!messageBody.trim()}>
                    Send
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          {/* Sidebar - Team by Shop */}
          <div>
            <Card title="Team by Shop" padding={false}>
              <div className="max-h-[550px] overflow-y-auto">
                {/* Company-wide option */}
                <button
                  onClick={() => { setSendToLocationId(undefined); setSelectedLocationFilter(undefined); }}
                  className={`flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 ${!sendToLocationId ? 'bg-primary/5' : ''}`}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Company-wide</p>
                    <p className="text-xs text-gray-500">Message all locations</p>
                  </div>
                </button>

                {/* Shops with employees */}
                {Array.from(teamByLocation.entries()).map(([locId, { location, members }]) => {
                  if (members.length === 0) return null;
                  const isCollapsed = collapsedShops.has(locId);
                  const isActive = sendToLocationId === locId;

                  return (
                    <div key={locId} className={isActive ? 'bg-primary/5' : ''}>
                      <div className="flex items-center border-b border-gray-100">
                        <button
                          onClick={() => toggleShopCollapse(locId)}
                          className="p-2 text-gray-400 hover:text-gray-600"
                        >
                          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => selectShopForMessage(locId)}
                          className="flex items-center gap-2 flex-1 py-2.5 pr-4 text-left hover:bg-gray-50 transition-colors"
                        >
                          <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
                          <span className="text-sm font-semibold text-gray-900 truncate">{location.name.replace('Six Beans - ', '')}</span>
                          <Badge variant="info">{members.length}</Badge>
                        </button>
                      </div>
                      {!isCollapsed && (
                        <div className="pl-6">
                          {members.map((member) => (
                            <div key={member.id} className="flex items-center gap-2 px-4 py-1.5 text-xs text-gray-600">
                              <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white ${member.role === 'manager' ? 'bg-amber-500' : member.role === 'owner' ? 'bg-primary' : 'bg-gray-400'}`}>
                                {member.first_name[0]}{member.last_name?.[0] ?? ''}
                              </div>
                              <span className="truncate">{member.first_name} {member.last_name}</span>
                              {member.role === 'manager' && <span className="text-[10px] text-amber-600 font-medium">MGR</span>}
                              {member.role === 'owner' && <span className="text-[10px] text-primary font-medium">OWNER</span>}
                            </div>
                          ))}
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
              <Select
                options={[{ value: '', label: 'All Locations' }, ...locationOptions]}
                value={selectedLocationFilter?.toString() ?? ''}
                onChange={(e) => setSelectedLocationFilter(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                className="w-48"
              />
            </div>
          )}

          {announcementsLoading ? (
            <LoadingSpinner className="py-20" label="Loading announcements..." />
          ) : announcements && announcements.length > 0 ? (
            <div className="space-y-4">
              {announcements.map((a: any) => (
                <Card key={a.id}>
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 flex-shrink-0">
                      <Bell className="h-5 w-5 text-yellow-600" />
                    </div>
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
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {allLocations?.find((l) => l.id === a.location_id)?.name ?? `Location #${a.location_id}`}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState icon={<Bell className="h-12 w-12" />} title="No Announcements" description="There are no announcements at this time." />
            </Card>
          )}
        </div>
      )}

      {/* New Announcement Modal */}
      <Modal open={showAnnouncementModal} onClose={() => setShowAnnouncementModal(false)} title="Post Announcement">
        <div className="space-y-4">
          <Input label="Subject" value={announcementSubject} onChange={(e) => setAnnouncementSubject(e.target.value)} placeholder="Announcement title (optional)" />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Message</label>
            <textarea
              value={announcementBody}
              onChange={(e) => setAnnouncementBody(e.target.value)}
              placeholder="Write your announcement..."
              rows={4}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <Select
            label="Location (optional)"
            options={[{ value: '', label: 'All Locations (company-wide)' }, ...locationOptions]}
            value={announcementLocationId}
            onChange={(e) => setAnnouncementLocationId(e.target.value)}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowAnnouncementModal(false)}>Cancel</Button>
            <Button onClick={handleSendAnnouncement} loading={sendAnnouncementMutation.isPending} disabled={!announcementBody.trim()}>
              Post Announcement
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
