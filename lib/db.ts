import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// .env.local ships with placeholder values (e.g. "YOUR_SUPABASE_URL") so the
// build succeeds before a real Supabase project is wired up. Anything that
// isn't a real http(s) URL falls back to a syntactically valid placeholder —
// requests will fail loudly at runtime with a clear network/auth error
// instead of crashing the build.
const supabaseUrl = isValidHttpUrl(rawUrl) ? rawUrl : 'https://placeholder.supabase.co';

// Client-side Supabase instance (anon key, row-level security enforced).
// Must be @supabase/ssr's createBrowserClient, not plain @supabase/supabase-js
// createClient — that stores the session in localStorage only, which the
// server (middleware, and every requireUser() check in an API route) can
// never see. createBrowserClient persists the session to cookies too, so a
// browser login is actually visible server-side on the very next request.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey || 'placeholder-anon-key');

// Server-side instance (service role key, bypasses RLS for admin operations)
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey || supabaseAnonKey || 'placeholder-service-key',
  {
    auth: {
      persistSession: false,
    },
  }
);

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          phone: string;
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
          // Set only when ProductPicker resolved to a real products.code —
          // historical imports and free-text "Other" purchases leave it null.
          product_code: string | null;
          enquiry_source: 'general' | 'water_test' | 'ready_to_buy' | 'referral' | null;
          referrer_name: string | null;
          referrer_phone: string | null;
          call_count: number;
          callback_date: string | null;
          closure_reason: string | null;
          closure_explanation: string | null;
          // Installation/Service fields
          planned_installation_date: string | null; // set at sale time, before a tech/date is actually booked
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
          // Recorded at conversion (§5.7), carried to the installation ticket
          agreed_price: number | null;
          cancellation_reason: string | null;
          // Set on service_visit tickets — points back at the triggering installation
          parent_installation_id: string | null;
        };
        Insert: Omit<Database['public']['Tables']['tickets']['Row'], 'id' | 'created_at' | 'updated_at' | 'call_count'>;
        Update: Partial<Database['public']['Tables']['tickets']['Row']>;
      };
      orders: {
        Row: {
          id: string;
          ticket_id: string;
          status: 'open' | 'closed';
          list_price: number;
          sold_price: number;
          paid_amount: number;
          discount: number; // generated column, read-only
          balance_owed: number; // generated column, read-only
          payment_history: { amount: number; date: string }[];
          confirmation_status: 'pending' | 'completed';
          confirmation_note: string | null;
          confirmed_at: string | null;
          last_payment_call_at: string | null;
          owner_notified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Pick<
          Database['public']['Tables']['orders']['Row'],
          'ticket_id' | 'list_price' | 'sold_price'
        > &
          Partial<Pick<Database['public']['Tables']['orders']['Row'], 'status' | 'paid_amount' | 'created_at'>>;
        Update: Partial<
          Omit<Database['public']['Tables']['orders']['Row'], 'discount' | 'balance_owed'>
        >;
      };
      products: {
        Row: {
          id: string;
          code: string; // the sheet's `sku` — unique per variant
          category: string;
          brand: string;
          name: string; // the sheet's `product_name`
          master_sku: string | null; // groups variant rows into one product
          variant: string | null;
          list_price: number | null; // no longer supplied by the sheet
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
          event_type: 'job_assigned' | 'job_completed' | 'leave_requested' | 'payment_reminder' | 'product_sync_failed';
          status: 'sent' | 'failed' | 'pending';
          error_message: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['notifications_log']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['notifications_log']['Row']>;
      };
      leave_requests: {
        Row: {
          id: string;
          requester_id: string;
          start_date: string;
          end_date: string;
          reason: string;
          status: 'pending' | 'approved' | 'denied';
          decided_by: string | null;
          decision_reason: string | null;
          decided_at: string | null;
          created_at: string;
        };
        Insert: Pick<
          Database['public']['Tables']['leave_requests']['Row'],
          'requester_id' | 'start_date' | 'end_date' | 'reason'
        >;
        Update: Partial<Database['public']['Tables']['leave_requests']['Row']>;
      };
    };
  };
};
