// =====================================================
// CAMPAIGNS SERVICE
// =====================================================
import { supabase } from '../supabase';
import { Campaign, CampaignInput, CampaignStatus, CampaignVolunteer, ApiResponse } from '../../types';

export const campaignsService = {
  // Get all campaigns
  async getAll(options?: {
    page?: number;
    pageSize?: number;
    status?: CampaignStatus;
    district?: string;
    type?: string;
  }): Promise<ApiResponse<Campaign[]>> {
    try {
      const { page = 1, pageSize = 20, status, district, type } = options || {};
      const offset = (page - 1) * pageSize;

      let query = supabase
        .from('health_campaigns')
        .select(`
          *,
          creator:profiles!created_by(id, full_name, email)
        `, { count: 'exact' })
        .order('start_date', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (status) query = query.eq('status', status);
      if (district) query = query.eq('district', district);
      if (type) query = query.eq('campaign_type', type);

      const { data, error, count } = await query;

      if (error) throw error;

      return { data: data as Campaign[], error: null, count: count || 0 };
    } catch (error: any) {
      console.error('Error fetching campaigns:', error);
      return { data: null, error: error.message };
    }
  },

  // Get single campaign by ID
  async getById(id: string): Promise<ApiResponse<Campaign>> {
    try {
      const { data, error } = await supabase
        .from('health_campaigns')
        .select(`
          *,
          creator:profiles!created_by(id, full_name, email, phone)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      return { data: data as Campaign, error: null };
    } catch (error: any) {
      console.error('Error fetching campaign:', error);
      return { data: null, error: error.message };
    }
  },

  // Create new campaign (Admin only)
  async create(campaignData: CampaignInput): Promise<ApiResponse<Campaign>> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('health_campaigns')
        .insert({
          ...campaignData,
          created_by: user.id,
          status: 'planned',
          reached_population: 0,
          volunteers_enrolled: 0,
          spent: 0,
        })
        .select()
        .single();

      if (error) throw error;

      return { data: data as Campaign, error: null };
    } catch (error: any) {
      console.error('Error creating campaign:', error);
      return { data: null, error: error.message };
    }
  },

  // Update campaign
  async update(id: string, updates: Partial<Campaign>): Promise<ApiResponse<Campaign>> {
    try {
      const { data, error } = await supabase
        .from('health_campaigns')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { data: data as Campaign, error: null };
    } catch (error: any) {
      console.error('Error updating campaign:', error);
      return { data: null, error: error.message };
    }
  },

  // Update campaign status
  async updateStatus(id: string, status: CampaignStatus): Promise<ApiResponse<Campaign>> {
    return this.update(id, { status });
  },

  // Delete campaign
  async delete(id: string): Promise<ApiResponse<null>> {
    try {
      const { error } = await supabase
        .from('health_campaigns')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return { data: null, error: null };
    } catch (error: any) {
      console.error('Error deleting campaign:', error);
      return { data: null, error: error.message };
    }
  },

  // Get active campaigns
  async getActive(): Promise<ApiResponse<Campaign[]>> {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('health_campaigns')
        .select(`
          *,
          creator:profiles!created_by(id, full_name)
        `)
        .in('status', ['planned', 'ongoing'])
        .gte('end_date', today)
        .order('start_date', { ascending: true });

      if (error) throw error;

      return { data: data as Campaign[], error: null };
    } catch (error: any) {
      console.error('Error fetching active campaigns:', error);
      return { data: null, error: error.message };
    }
  },

  // Get statistics
  async getStatistics(): Promise<ApiResponse<{
    totalCampaigns: number;
    activeCampaigns: number;
    completedCampaigns: number;
    totalVolunteers: number;
    totalReached: number;
  }>> {
    try {
      const { count: total } = await supabase
        .from('health_campaigns')
        .select('id', { count: 'exact', head: true });

      const { count: active } = await supabase
        .from('health_campaigns')
        .select('id', { count: 'exact', head: true })
        .in('status', ['planned', 'ongoing']);

      const { count: completed } = await supabase
        .from('health_campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed');

      const { data: campaignStats } = await supabase
        .from('health_campaigns')
        .select('volunteers_enrolled, reached_population');

      const totalVolunteers = campaignStats?.reduce((sum, c) => sum + (c.volunteers_enrolled || 0), 0) || 0;
      const totalReached = campaignStats?.reduce((sum, c) => sum + (c.reached_population || 0), 0) || 0;

      return {
        data: {
          totalCampaigns: total || 0,
          activeCampaigns: active || 0,
          completedCampaigns: completed || 0,
          totalVolunteers,
          totalReached,
        },
        error: null,
      };
    } catch (error: any) {
      console.error('Error fetching campaign statistics:', error);
      return { data: null, error: error.message };
    }
  },

  // Volunteer enrollment
  async enrollVolunteer(campaignId: string): Promise<ApiResponse<CampaignVolunteer>> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Check if already enrolled
      const { data: existing } = await supabase
        .from('campaign_volunteers')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('volunteer_id', user.id)
        .single();

      if (existing) {
        throw new Error('Already enrolled in this campaign');
      }

      const { data, error } = await supabase
        .from('campaign_volunteers')
        .insert({
          campaign_id: campaignId,
          volunteer_id: user.id,
          status: 'enrolled',
        })
        .select()
        .single();

      if (error) throw error;

      // Update volunteer count in campaign
      await supabase.rpc('increment_volunteers', { campaign_id: campaignId });

      return { data: data as CampaignVolunteer, error: null };
    } catch (error: any) {
      console.error('Error enrolling volunteer:', error);
      return { data: null, error: error.message };
    }
  },

  // Get volunteer's enrolled campaigns
  async getVolunteerCampaigns(volunteerId?: string): Promise<ApiResponse<CampaignVolunteer[]>> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const id = volunteerId || user?.id;
      if (!id) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('campaign_volunteers')
        .select(`
          *,
          campaign:health_campaigns(*)
        `)
        .eq('volunteer_id', id)
        .order('enrolled_at', { ascending: false });

      if (error) throw error;

      return { data: data as CampaignVolunteer[], error: null };
    } catch (error: any) {
      console.error('Error fetching volunteer campaigns:', error);
      return { data: null, error: error.message };
    }
  },

  // Get campaign volunteers
  async getCampaignVolunteers(campaignId: string): Promise<ApiResponse<CampaignVolunteer[]>> {
    try {
      const { data, error } = await supabase
        .from('campaign_volunteers')
        .select(`
          *,
          volunteer:profiles!volunteer_id(id, full_name, email, phone)
        `)
        .eq('campaign_id', campaignId)
        .order('enrolled_at', { ascending: false });

      if (error) throw error;

      return { data: data as CampaignVolunteer[], error: null };
    } catch (error: any) {
      console.error('Error fetching campaign volunteers:', error);
      return { data: null, error: error.message };
    }
  },

  // Withdraw from campaign
  async withdrawVolunteer(campaignId: string): Promise<ApiResponse<null>> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { error } = await supabase
        .from('campaign_volunteers')
        .delete()
        .eq('campaign_id', campaignId)
        .eq('volunteer_id', user.id);

      if (error) throw error;

      return { data: null, error: null };
    } catch (error: any) {
      console.error('Error withdrawing volunteer:', error);
      return { data: null, error: error.message };
    }
  },
};

export default campaignsService;
