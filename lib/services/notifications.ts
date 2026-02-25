// =====================================================
// NOTIFICATIONS SERVICE
// =====================================================
import { supabase } from '../supabase';
import { Notification, NotificationType, NotificationPriority, ApiResponse } from '../../types';

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
