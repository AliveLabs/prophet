export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      busy_times: {
        Row: {
          competitor_id: string
          created_at: string
          current_popularity: number | null
          day_of_week: number
          hourly_scores: number[]
          id: string
          peak_hour: number | null
          peak_score: number | null
          slow_hours: number[] | null
          snapshot_id: string | null
          typical_time_spent: string | null
        }
        Insert: {
          competitor_id: string
          created_at?: string
          current_popularity?: number | null
          day_of_week: number
          hourly_scores: number[]
          id?: string
          peak_hour?: number | null
          peak_score?: number | null
          slow_hours?: number[] | null
          snapshot_id?: string | null
          typical_time_spent?: string | null
        }
        Update: {
          competitor_id?: string
          created_at?: string
          current_popularity?: number | null
          day_of_week?: number
          hourly_scores?: number[]
          id?: string
          peak_hour?: number | null
          peak_score?: number | null
          slow_hours?: number[] | null
          snapshot_id?: string | null
          typical_time_spent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "busy_times_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_photos: {
        Row: {
          analysis_result: Json | null
          author_attribution: Json | null
          competitor_id: string
          created_at: string
          first_seen_at: string
          height_px: number | null
          id: string
          image_hash: string
          image_url: string | null
          last_seen_at: string
          place_photo_name: string
          snapshot_id: string | null
          width_px: number | null
        }
        Insert: {
          analysis_result?: Json | null
          author_attribution?: Json | null
          competitor_id: string
          created_at?: string
          first_seen_at?: string
          height_px?: number | null
          id?: string
          image_hash: string
          image_url?: string | null
          last_seen_at?: string
          place_photo_name: string
          snapshot_id?: string | null
          width_px?: number | null
        }
        Update: {
          analysis_result?: Json | null
          author_attribution?: Json | null
          competitor_id?: string
          created_at?: string
          first_seen_at?: string
          height_px?: number | null
          id?: string
          image_hash?: string
          image_url?: string | null
          last_seen_at?: string
          place_photo_name?: string
          snapshot_id?: string | null
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_photos_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          address: string | null
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          last_seen_at: string | null
          location_id: string
          metadata: Json
          name: string | null
          phone: string | null
          provider: string
          provider_entity_id: string
          relevance_score: number | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          location_id: string
          metadata?: Json
          name?: string | null
          phone?: string | null
          provider?: string
          provider_entity_id: string
          relevance_score?: number | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          location_id?: string
          metadata?: Json
          name?: string | null
          phone?: string | null
          provider?: string
          provider_entity_id?: string
          relevance_score?: number | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitors_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_matches: {
        Row: {
          competitor_id: string | null
          confidence: string
          created_at: string
          date_key: string
          event_uid: string
          evidence: Json
          id: string
          location_id: string
          match_type: string
        }
        Insert: {
          competitor_id?: string | null
          confidence: string
          created_at?: string
          date_key: string
          event_uid: string
          evidence?: Json
          id?: string
          location_id: string
          match_type: string
        }
        Update: {
          competitor_id?: string | null
          confidence?: string
          created_at?: string
          date_key?: string
          event_uid?: string
          evidence?: Json
          id?: string
          location_id?: string
          match_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_matches_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_matches_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_preferences: {
        Row: {
          dismissed_count: number
          insight_type: string
          last_feedback_at: string
          organization_id: string
          useful_count: number
          weight: number
        }
        Insert: {
          dismissed_count?: number
          insight_type: string
          last_feedback_at?: string
          organization_id: string
          useful_count?: number
          weight?: number
        }
        Update: {
          dismissed_count?: number
          insight_type?: string
          last_feedback_at?: string
          organization_id?: string
          useful_count?: number
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "insight_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      insights: {
        Row: {
          competitor_id: string | null
          confidence: string
          created_at: string
          date_key: string
          evidence: Json
          feedback_at: string | null
          feedback_by: string | null
          id: string
          insight_type: string
          location_id: string
          recommendations: Json
          severity: string
          status: string
          summary: string
          title: string
          user_feedback: string | null
        }
        Insert: {
          competitor_id?: string | null
          confidence: string
          created_at?: string
          date_key: string
          evidence?: Json
          feedback_at?: string | null
          feedback_by?: string | null
          id?: string
          insight_type: string
          location_id: string
          recommendations?: Json
          severity?: string
          status?: string
          summary: string
          title: string
          user_feedback?: string | null
        }
        Update: {
          competitor_id?: string | null
          confidence?: string
          created_at?: string
          date_key?: string
          evidence?: Json
          feedback_at?: string | null
          feedback_by?: string | null
          id?: string
          insight_type?: string
          location_id?: string
          recommendations?: Json
          severity?: string
          status?: string
          summary?: string
          title?: string
          user_feedback?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insights_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insights_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          attempt: number
          created_at: string
          finished_at: string | null
          id: string
          job_type: string
          message: string | null
          metadata: Json
          organization_id: string
          started_at: string | null
          status: string
          trace_id: string | null
        }
        Insert: {
          attempt?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          job_type: string
          message?: string | null
          metadata?: Json
          organization_id: string
          started_at?: string | null
          status?: string
          trace_id?: string | null
        }
        Update: {
          attempt?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          job_type?: string
          message?: string | null
          metadata?: Json
          organization_id?: string
          started_at?: string | null
          status?: string
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_snapshots: {
        Row: {
          captured_at: string
          created_at: string
          date_key: string
          diff_hash: string
          id: string
          location_id: string
          provider: string
          raw_data: Json
        }
        Insert: {
          captured_at: string
          created_at?: string
          date_key: string
          diff_hash: string
          id?: string
          location_id: string
          provider: string
          raw_data: Json
        }
        Update: {
          captured_at?: string
          created_at?: string
          date_key?: string
          diff_hash?: string
          id?: string
          location_id?: string
          provider?: string
          raw_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "location_snapshots_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_weather: {
        Row: {
          created_at: string
          date: string
          feels_like_high_f: number | null
          humidity_avg: number | null
          id: string
          is_severe: boolean
          location_id: string
          precipitation_in: number | null
          temp_high_f: number | null
          temp_low_f: number | null
          weather_condition: string | null
          weather_description: string | null
          weather_icon: string | null
          wind_speed_max_mph: number | null
        }
        Insert: {
          created_at?: string
          date: string
          feels_like_high_f?: number | null
          humidity_avg?: number | null
          id?: string
          is_severe?: boolean
          location_id: string
          precipitation_in?: number | null
          temp_high_f?: number | null
          temp_low_f?: number | null
          weather_condition?: string | null
          weather_description?: string | null
          weather_icon?: string | null
          wind_speed_max_mph?: number | null
        }
        Update: {
          created_at?: string
          date?: string
          feels_like_high_f?: number | null
          humidity_avg?: number | null
          id?: string
          is_severe?: boolean
          location_id?: string
          precipitation_in?: number | null
          temp_high_f?: number | null
          temp_low_f?: number | null
          weather_condition?: string | null
          weather_description?: string | null
          weather_icon?: string | null
          wind_speed_max_mph?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "location_weather_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          country: string | null
          created_at: string
          geo_lat: number | null
          geo_lng: number | null
          id: string
          name: string
          organization_id: string
          postal_code: string | null
          primary_place_id: string | null
          region: string | null
          settings: Json
          timezone: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          name: string
          organization_id: string
          postal_code?: string | null
          primary_place_id?: string | null
          region?: string | null
          settings?: Json
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          name?: string
          organization_id?: string
          postal_code?: string | null
          primary_place_id?: string | null
          region?: string | null
          settings?: Json
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          billing_email: string | null
          created_at: string
          id: string
          name: string
          settings: Json
          slug: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_tier: string
          trial_ends_at: string | null
          trial_started_at: string | null
          updated_at: string
        }
        Insert: {
          billing_email?: string | null
          created_at?: string
          id?: string
          name: string
          settings?: Json
          slug: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_tier?: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_email?: string | null
          created_at?: string
          id?: string
          name?: string
          settings?: Json
          slug?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_tier?: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          current_organization_id: string | null
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          current_organization_id?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          current_organization_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_current_organization_id_fkey"
            columns: ["current_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      refresh_jobs: {
        Row: {
          created_at: string
          current_step: number
          id: string
          job_type: string
          location_id: string
          organization_id: string
          result: Json | null
          status: string
          steps: Json
          total_steps: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_step?: number
          id?: string
          job_type: string
          location_id: string
          organization_id: string
          result?: Json | null
          status?: string
          steps?: Json
          total_steps?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_step?: number
          id?: string
          job_type?: string
          location_id?: string
          organization_id?: string
          result?: Json | null
          status?: string
          steps?: Json
          total_steps?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refresh_jobs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refresh_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      snapshots: {
        Row: {
          captured_at: string
          competitor_id: string
          created_at: string
          date_key: string
          diff_hash: string
          id: string
          provider: string
          raw_data: Json
          snapshot_type: string
        }
        Insert: {
          captured_at: string
          competitor_id: string
          created_at?: string
          date_key: string
          diff_hash: string
          id?: string
          provider: string
          raw_data: Json
          snapshot_type?: string
        }
        Update: {
          captured_at?: string
          competitor_id?: string
          created_at?: string
          date_key?: string
          diff_hash?: string
          id?: string
          provider?: string
          raw_data?: Json
          snapshot_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "snapshots_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      social_profiles: {
        Row: {
          created_at: string
          discovery_method: string
          entity_id: string
          entity_type: string
          handle: string
          id: string
          is_verified: boolean
          metadata: Json
          platform: string
          profile_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          discovery_method?: string
          entity_id: string
          entity_type: string
          handle: string
          id?: string
          is_verified?: boolean
          metadata?: Json
          platform: string
          profile_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          discovery_method?: string
          entity_id?: string
          entity_type?: string
          handle?: string
          id?: string
          is_verified?: boolean
          metadata?: Json
          platform?: string
          profile_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      social_snapshots: {
        Row: {
          captured_at: string
          created_at: string
          date_key: string
          diff_hash: string
          id: string
          raw_data: Json
          social_profile_id: string
        }
        Insert: {
          captured_at: string
          created_at?: string
          date_key: string
          diff_hash: string
          id?: string
          raw_data: Json
          social_profile_id: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          date_key?: string
          diff_hash?: string
          id?: string
          raw_data?: Json
          social_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_snapshots_social_profile_id_fkey"
            columns: ["social_profile_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tracked_keywords: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          keyword: string
          location_id: string
          source: string
          tags: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          keyword: string
          location_id: string
          source?: string
          tags?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          keyword?: string
          location_id?: string
          source?: string
          tags?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracked_keywords_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_signups: {
        Row: {
          business_name: string | null
          city: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          notes: string | null
          referred_by: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          business_name?: string | null
          city?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          referred_by?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          business_name?: string | null
          city?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          referred_by?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_org_admin: { Args: { org_id: string }; Returns: boolean }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
