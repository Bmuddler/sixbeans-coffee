import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Send,
  Bell,
  MapPin,
  Plus,
  ChevronDown,
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
import { UserRole, type Message, type Location } from '@/types';
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
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('messages');
  const [selectedLocationId, setSelectedLocationId] = useState<number | undefined>(
    user?.primary_location_id
  );
  const [messageBody, setMessageBody] = useState('');
  const [recipientId, setRecipientId] = useState<string>('');
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [announcementSubject, setAnnouncementSubject] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [announcementLocationId, setAnnouncementLocationId] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isManagerOrOwner =
    user?.role === UserRole.MANAGER || user?.role === UserRole.OWNER;
  const isOwner = user?.role === UserRole.OWNER;

  // Fetch locations for filtering
  const { data: allLocations } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsApi.list,
    enabled: isManagerOrOwner,
  });

  // Fetch team members for direct messages
  const { data: teamMembers } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => usersApi.list({ per_page: 100 }),
  });

  // Fetch messages with polling
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['messages', activeTab],
    queryFn: () => messagesApi.list({ per_page: 50 }),
    refetchInterval: 15000,
  });

  // Fetch announcements with polling
  const { data: announcements, isLoading: announcementsLoading } = useQuery({
    queryKey: ['announcements', selectedLocationId],
    queryFn: () =>
      messagesApi.getAnnouncements(
        selectedLocationId ? { location_id: selectedLocationId } : undefined
      ),
    refetchInterval: 30000,
  });

  // Send location message
  const sendMessageMutation = useMutation({
    mutationFn: (data: { body: string; location_id?: number }) =>
      messagesApi.send(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      setMessageBody('');
      toast.success('Message sent!');
    },
    onError: () => toast.error('Failed to send message.'),
  });

  // Send announcement
  const sendAnnouncementMutation = useMutation({
    mutationFn: (data: { location_id?: number; subject?: string; body: string }) =>
      messagesApi.sendAnnouncement(data),
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

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesData]);

  const handleSendMessage = () => {
    if (!messageBody.trim()) return;
    sendMessageMutation.mutate({
      body: messageBody.trim(),
      location_id: recipientId ? parseInt(recipientId, 10) : undefined,
    });
  };

  const handleSendAnnouncement = () => {
    if (!announcementBody.trim()) return;
    sendAnnouncementMutation.mutate({
      location_id: announcementLocationId
        ? parseInt(announcementLocationId, 10)
        : undefined,
      subject: announcementSubject.trim() || undefined,
      body: announcementBody.trim(),
    });
  };

  const allMessages = messagesData?.items ?? [];
  const directMessages = allMessages.filter((m) => !m.is_announcement);
  const unreadCount = directMessages.filter((m) => !m.is_read && m.recipient_id === user?.id).length;

  const recipientOptions = [
    { value: '', label: 'Company-wide' },
    ...(allLocations?.map((loc) => ({
      value: loc.id.toString(),
      label: loc.name,
    })) ?? []),
  ];

  const locationOptions =
    allLocations?.map((loc) => ({
      value: loc.id.toString(),
      label: loc.name,
    })) ?? [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Messages</h1>
          <p className="page-subtitle">
            Send and receive messages and announcements.
          </p>
        </div>
        {isOwner && (
          <Button
            icon={<Plus className="h-4 w-4" />}
            onClick={() => setShowAnnouncementModal(true)}
          >
            New Announcement
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'messages'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('messages')}
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Messages
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-medium text-white">
                {unreadCount}
              </span>
            )}
          </div>
        </button>
        <button
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'announcements'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
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
              <div className="h-[500px] overflow-y-auto">
                {messagesLoading ? (
                  <LoadingSpinner className="py-20" label="Loading messages..." />
                ) : directMessages.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {directMessages.map((msg) => {
                      const isMine = msg.sender_id === user?.id;
                      return (
                        <div
                          key={msg.id}
                          className={`px-6 py-4 ${
                            !msg.is_read && !isMine ? 'bg-blue-50/50' : ''
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white flex-shrink-0 ${
                                isMine ? 'bg-primary' : 'bg-gray-400'
                              }`}
                            >
                              {msg.sender
                                ? `${msg.sender.first_name[0]}${msg.sender.last_name[0]}`
                                : '??'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-medium text-gray-900">
                                  {msg.sender
                                    ? `${msg.sender.first_name} ${msg.sender.last_name}`
                                    : 'Unknown'}
                                  {isMine && (
                                    <span className="ml-1 text-xs text-gray-400">(you)</span>
                                  )}
                                </p>
                                <span className="text-xs text-gray-400">
                                  {formatTimestamp(msg.created_at)}
                                </span>
                              </div>
                              {msg.subject && (
                                <p className="text-sm font-medium text-gray-700 mt-0.5">
                                  {msg.subject}
                                </p>
                              )}
                              <p className="text-sm text-gray-600 mt-1">{msg.body}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                ) : (
                  <EmptyState
                    icon={<MessageSquare className="h-12 w-12" />}
                    title="No Messages"
                    description="Your inbox is empty. Send a message to a team member to get started."
                  />
                )}
              </div>

              {/* Message Input */}
              <div className="border-t border-gray-200 px-6 py-4">
                <div className="flex gap-3">
                  <div className="w-48 flex-shrink-0">
                    <Select
                      options={recipientOptions}
                      value={recipientId}
                      onChange={(e) => setRecipientId(e.target.value)}
                      placeholder="Select location"
                    />
                  </div>
                  <div className="flex-1">
                    <input
                      type="text"
                      value={messageBody}
                      onChange={(e) => setMessageBody(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder="Type a message..."
                      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-300"
                    />
                  </div>
                  <Button
                    icon={<Send className="h-4 w-4" />}
                    onClick={handleSendMessage}
                    loading={sendMessageMutation.isPending}
                    disabled={!messageBody.trim()}
                  >
                    Send
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          {/* Sidebar - Recent Contacts */}
          <div>
            <Card title="Team Members">
              {recipientOptions.length > 0 ? (
                <ul className="divide-y divide-gray-100">
                  {recipientOptions.slice(0, 15).map((member) => (
                    <li key={member.value}>
                      <button
                        className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-gray-50 transition-colors rounded px-2 -mx-2"
                        onClick={() => setRecipientId(member.value)}
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">
                          {member.label
                            .split(' ')
                            .map((n) => n[0])
                            .join('')}
                        </div>
                        <span className="text-sm text-gray-700">{member.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No team members found.</p>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Announcements Tab */}
      {activeTab === 'announcements' && (
        <div>
          {/* Location filter for managers/owners */}
          {isManagerOrOwner && locationOptions.length > 0 && (
            <div className="mb-4 flex items-center gap-3">
              <MapPin className="h-4 w-4 text-gray-400" />
              <Select
                options={[
                  { value: '', label: 'All Locations' },
                  ...locationOptions,
                ]}
                value={selectedLocationId?.toString() ?? ''}
                onChange={(e) =>
                  setSelectedLocationId(
                    e.target.value ? parseInt(e.target.value, 10) : undefined
                  )
                }
                className="w-48"
              />
            </div>
          )}

          {announcementsLoading ? (
            <LoadingSpinner className="py-20" label="Loading announcements..." />
          ) : announcements && announcements.length > 0 ? (
            <div className="space-y-4">
              {announcements.map((announcement) => (
                <Card key={announcement.id}>
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 flex-shrink-0">
                      <Bell className="h-5 w-5 text-yellow-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between">
                        <div>
                          {announcement.subject && (
                            <h3 className="text-base font-semibold text-gray-900">
                              {announcement.subject}
                            </h3>
                          )}
                          <p className="text-sm text-gray-600 mt-1">
                            {announcement.body}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
                        <span>
                          {announcement.sender
                            ? `${announcement.sender.first_name} ${announcement.sender.last_name}`
                            : 'System'}
                        </span>
                        <span>-</span>
                        <span>{formatTimestamp(announcement.created_at)}</span>
                        {announcement.location_id && (
                          <>
                            <span>-</span>
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {allLocations?.find(
                                (l) => l.id === announcement.location_id
                              )?.name ?? `Location #${announcement.location_id}`}
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
              <EmptyState
                icon={<Bell className="h-12 w-12" />}
                title="No Announcements"
                description="There are no announcements at this time."
              />
            </Card>
          )}
        </div>
      )}

      {/* New Announcement Modal */}
      <Modal
        open={showAnnouncementModal}
        onClose={() => setShowAnnouncementModal(false)}
        title="Post Announcement"
      >
        <div className="space-y-4">
          <Input
            label="Subject"
            value={announcementSubject}
            onChange={(e) => setAnnouncementSubject(e.target.value)}
            placeholder="Announcement title (optional)"
          />
          <div className="w-full">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Message
            </label>
            <textarea
              value={announcementBody}
              onChange={(e) => setAnnouncementBody(e.target.value)}
              placeholder="Write your announcement..."
              rows={4}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
          <Select
            label="Location (optional)"
            options={[
              { value: '', label: 'All Locations (company-wide)' },
              ...locationOptions,
            ]}
            value={announcementLocationId}
            onChange={(e) => setAnnouncementLocationId(e.target.value)}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="ghost"
              onClick={() => setShowAnnouncementModal(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSendAnnouncement}
              loading={sendAnnouncementMutation.isPending}
              disabled={!announcementBody.trim()}
            >
              Post Announcement
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
