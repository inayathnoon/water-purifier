import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Allow build to complete even without env vars; runtime will fail with clear error
const isBuilding = process.env.NODE_ENV === 'production' && !supabaseUrl;

// Client-side Supabase instance (anon key, row-level security enforced)
export const supabase = isBuilding
  ? (null as any)
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });

// Server-side instance (service role key, bypasses RLS for admin operations)
export const supabaseAdmin = isBuilding
  ? (null as any)
  : createClient(supabaseUrl, supabaseServiceRoleKey || supabaseAnonKey, {
      auth: {
        persistSession: false,
      },
    });

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          role: 'owner' | 'admin' | 'service_staff';
          name: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['users']['Row']>;
      };
      customers: {
        Row: {
          id: string;
          phone_number: string;
          name: string;
          address: string;
          area: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['customers']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['customers']['Row']>;
      };
      tickets: {
        Row: {
          id: string;
          customer_id: string;
          kind: 'enquiry' | 'installation' | 'service_visit';
          status: 'open' | 'booked' | 'completed' | 'closed' | 'passed_to_owner' | 'inactive';
          assigned_to_id: string | null;
          created_at: string;
          updated_at: string;
          // Enquiry fields
          enquiry_product_interest: string | null;
          call_count: number;
          callback_date: string | null;
          closure_reason: string | null;
          closure_explanation: string | null;
          // Installation/Service fields
          booked_date: string | null;
          booked_half_day: 'morning' | 'afternoon' | 'evening' | null;
          location: 'home' | 'office' | null;
          actual_date: string | null;
          actual_start_time: string | null;
          actual_end_time: string | null;
          actual_notes: string | null;
          parts_used: string | null;
          charge_amount: number | null;
          // Warranty/Service fields
          installation_date: string | null;
          warranty_expires_at: string | null;
          service_declined: boolean;
        };
        Insert: Omit<Database['public']['Tables']['tickets']['Row'], 'id' | 'created_at' | 'updated_at' | 'call_count'>;
        Update: Partial<Database['public']['Tables']['tickets']['Row']>;
      };
      orders: {
        Row: {
          id: string;
          ticket_id: string;
          list_price: number;
          sold_price: number;
          discount: number;
          balance_owed: number;
          paid_amount: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['orders']['Row'], 'id' | 'discount' | 'balance_owed' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['orders']['Row']>;
      };
      products: {
        Row: {
          id: string;
          code: string;
          category: string;
          type: string;
          brand: string;
          name: string;
          list_price: number;
          active: boolean;
          last_synced_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['products']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['products']['Row']>;
      };
      notifications_log: {
        Row: {
          id: string;
          event_type: 'job_assigned' | 'job_completed' | 'leave_requested' | 'payment_reminder';
          status: 'sent' | 'failed' | 'pending';
          error_message: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['notifications_log']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['notifications_log']['Row']>;
      };
    };
  };
};
