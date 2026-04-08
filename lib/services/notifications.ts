// =====================================================
// NOTIFICATIONS SERVICE
// =====================================================
import { supabase } from '../supabase';
import { Notification, NotificationType, NotificationPriority, ApiResponse } from '../../types';

interface SendAlertPushNotificationsOptions {
  alertId?: string;
  title: string;
  body: string;
  alertSeverity?: 'critical' | 'high' | 'medium' | 'low' | string;
  targetRoles?: string[];
  targetDistrict?: string;
  minSeverity?: string;
  fallbackScope?: 'officials' | 'all';
}

const OFFICIAL_ROLES = ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker'];

const chunkArray = <T>(input: T[], chunkSize: number): T[][] => {
  const size = Math.max(1, chunkSize);
  const chunks: T[][] = [];

  for (let index = 0; index < input.length; index += size) {
    chunks.push(input.slice(index, index + size));
  }

  return chunks;
};

const toPushPriority = (severity?: string): 'default' | 'normal' | 'high' => {
  const value = String(severity ?? '').toLowerCase();
  if (value === 'critical' || value === 'high') return 'high';
  if (value === 'medium') return 'normal';
  return 'default';
};

export const notificationsService = {
  // Get user's notifications
  async getAll(options?: {
    page?: number;
    pageSize?: number;
    unreadOnly?: boolean;
  }): Promise<ApiResponse<Notification[]>> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { page = 1, pageSize = 20, unreadOnly } = options || {};
      const offset = (page - 1) * pageSize;

      // Get user's profile to check role and district
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, district')
        .eq('id', user.id)
        .single();

      let query = supabase
        .from('notifications')
        .select('*', { count: 'exact' })
        .or(`user_id.eq.${user.id},user_id.is.null`)
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (unreadOnly) {
        query = query.eq('is_read', false);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      // Filter by role and district for broadcast notifications
      const filteredData = data?.filter(n => {
        if (n.user_id === user.id) return true;
        if (n.target_role && n.target_role !== profile?.role) return false;
        if (n.target_district && n.target_district !== profile?.district) return false;
        return true;
      });

      return { data: filteredData as Notification[], error: null, count: count || 0 };
    } catch (error: any) {
      console.error('Error fetching notifications:', error);
      return { data: null, error: error.message };
    }
  },

  // Get unread count
  async getUnreadCount(): Promise<ApiResponse<number>> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .or(`user_id.eq.${user.id},user_id.is.null`)
        .eq('is_read', false);

      if (error) throw error;

      return { data: count || 0, error: null };
    } catch (error: any) {
      console.error('Error fetching unread count:', error);
      return { data: null, error: error.message };
    }
  },

  // Mark notification as read
  async markAsRead(id: string): Promise<ApiResponse<Notification>> {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { data: data as Notification, error: null };
    } catch (error: any) {
      console.error('Error marking notification as read:', error);
      return { data: null, error: error.message };
    }
  },

  // Mark all as read
  async markAllAsRead(): Promise<ApiResponse<null>> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { error } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .or(`user_id.eq.${user.id},user_id.is.null`)
        .eq('is_read', false);

      if (error) throw error;

      return { data: null, error: null };
    } catch (error: any) {
      console.error('Error marking all notifications as read:', error);
      return { data: null, error: error.message };
    }
  },

  // Create notification (Admin only)
  async create(notification: {
    title: string;
    message: string;
    type: NotificationType;
    priority?: NotificationPriority;
    userId?: string;
    targetRole?: string;
    targetDistrict?: string;
    relatedType?: string;
    relatedId?: string;
  }): Promise<ApiResponse<Notification>> {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .insert({
          title: notification.title,
          message: notification.message,
          type: notification.type,
          priority: notification.priority || 'normal',
          user_id: notification.userId || null,
          target_role: notification.targetRole || null,
          target_district: notification.targetDistrict || null,
          related_type: notification.relatedType || null,
          related_id: notification.relatedId || null,
        })
        .select()
        .single();

      if (error) throw error;

      return { data: data as Notification, error: null };
    } catch (error: any) {
      console.error('Error creating notification:', error);
      return { data: null, error: error.message };
    }
  },

  // Send alert notification
  async sendAlert(options: {
    title: string;
    message: string;
    priority: NotificationPriority;
    targetRole?: string;
    targetDistrict?: string;
  }): Promise<ApiResponse<Notification>> {
    return this.create({
      ...options,
      type: 'alert',
    });
  },

  // Best-effort push dispatch used by AI alert acceptance workflows.
  async sendAlertPushNotifications(
    options: SendAlertPushNotificationsOptions
  ): Promise<ApiResponse<number>> {
    try {
      const requestedRoles = (options.targetRoles ?? []).filter((role) => typeof role === 'string' && role.trim().length > 0);
      const roles = requestedRoles.length > 0
        ? Array.from(new Set(requestedRoles.map((role) => role.trim())))
        : options.fallbackScope === 'officials'
          ? OFFICIAL_ROLES
          : [];

      let query = supabase
        .from('profiles')
        .select('expo_push_token, role, district')
        .not('expo_push_token', 'is', null);

      if (roles.length > 0) {
        query = query.in('role', roles);
      }

      if (options.targetDistrict) {
        query = query.eq('district', options.targetDistrict);
      }

      const { data: profilesWithTokens, error: profileError } = await query;
      if (profileError) {
        const message = String(profileError.message ?? '').toLowerCase();
        // Allow deployments that have not applied push-token schema yet.
        if (message.includes('expo_push_token') || message.includes('column')) {
          return { data: 0, error: null };
        }
        throw profileError;
      }

      const tokens = Array.from(new Set((profilesWithTokens ?? [])
        .map((profile: any) => profile?.expo_push_token)
        .filter((token): token is string => typeof token === 'string' && token.trim().length > 0)));

      if (tokens.length === 0) {
        return { data: 0, error: null };
      }

      const payloadBase = {
        title: `[ALERT] ${options.title}`,
        body: options.body,
        sound: 'default',
        priority: toPushPriority(options.alertSeverity ?? options.minSeverity),
        data: {
          type: 'health_alert',
          alertId: options.alertId ?? null,
          severity: options.alertSeverity ?? options.minSeverity ?? null,
        },
      };

      let sentCount = 0;
      const tokenChunks = chunkArray(tokens, 100);

      for (const chunk of tokenChunks) {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(
            chunk.map((token) => ({
              to: token,
              ...payloadBase,
            }))
          ),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Push dispatch failed: ${response.status} ${body}`);
        }

        sentCount += chunk.length;
      }

      return { data: sentCount, error: null };
    } catch (error: any) {
      console.warn('Error sending alert push notifications:', error);
      return { data: 0, error: error?.message ?? 'Failed to send alert push notifications.' };
    }
  },

  // Send campaign notification
  async sendCampaignNotification(options: {
    title: string;
    message: string;
    campaignId: string;
    targetRole?: string;
    targetDistrict?: string;
  }): Promise<ApiResponse<Notification>> {
    return this.create({
      title: options.title,
      message: options.message,
      type: 'campaign',
      relatedType: 'campaign',
      relatedId: options.campaignId,
      targetRole: options.targetRole,
      targetDistrict: options.targetDistrict,
    });
  },

  // Delete notification
  async delete(id: string): Promise<ApiResponse<null>> {
    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return { data: null, error: null };
    } catch (error: any) {
      console.error('Error deleting notification:', error);
      return { data: null, error: error.message };
    }
  },

  // Clear old notifications (Admin only)
  async clearOld(daysOld: number = 30): Promise<ApiResponse<null>> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const { error } = await supabase
        .from('notifications')
        .delete()
        .lt('created_at', cutoffDate.toISOString())
        .eq('is_read', true);

      if (error) throw error;

      return { data: null, error: null };
    } catch (error: any) {
      console.error('Error clearing old notifications:', error);
      return { data: null, error: error.message };
    }
  },
};

export default notificationsService;
