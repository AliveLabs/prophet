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
      admin_activity_log: {
        Row: {
          action: string
          actor_type: string
          admin_email: string | null
          admin_user_id: string
          created_at: string | null
          details: Json | null
          id: string
          reason: string | null
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_type?: string
          admin_email?: string | null
          admin_user_id: string
          created_at?: string | null
          details?: Json | null
          id?: string
          reason?: string | null
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_type?: string
          admin_email?: string | null
          admin_user_id?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          reason?: string | null
          target_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      ai_spend_events: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          created_at: string
          estimated_usd: number
          id: string
          input_tokens: number
          location_id: string | null
          metadata: Json
          model: string
          output_tokens: number
          provider: string
          surface: string
        }
        Insert: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          created_at?: string
          estimated_usd?: number
          id?: string
          input_tokens?: number
          location_id?: string | null
          metadata?: Json
          model: string
          output_tokens?: number
          provider: string
          surface: string
        }
        Update: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          created_at?: string
          estimated_usd?: number
          id?: string
          input_tokens?: number
          location_id?: string | null
          metadata?: Json
          model?: string
          output_tokens?: number
          provider?: string
          surface?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_spend_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      ask_history: {
        Row: {
          answer: string
          asked_by: string | null
          confidence: string
          created_at: string
          grounded: boolean
          id: string
          location_id: string
          question: string
          source: string
          sources: Json
        }
        Insert: {
          answer: string
          asked_by?: string | null
          confidence?: string
          created_at?: string
          grounded?: boolean
          id?: string
          location_id: string
          question: string
          source?: string
          sources?: Json
        }
        Update: {
          answer?: string
          asked_by?: string | null
          confidence?: string
          created_at?: string
          grounded?: boolean
          id?: string
          location_id?: string
          question?: string
          source?: string
          sources?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ask_history_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_feedback: {
        Row: {
          business_name: string | null
          category: string | null
          created_at: string
          email: string | null
          id: string
          location_id: string | null
          message: string
          notion_error: string | null
          notion_page_id: string | null
          notion_synced_at: string | null
          organization_id: string | null
          page_path: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          business_name?: string | null
          category?: string | null
          created_at?: string
          email?: string | null
          id?: string
          location_id?: string | null
          message: string
          notion_error?: string | null
          notion_page_id?: string | null
          notion_synced_at?: string | null
          organization_id?: string | null
          page_path?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          business_name?: string | null
          category?: string | null
          created_at?: string
          email?: string | null
          id?: string
          location_id?: string | null
          message?: string
          notion_error?: string | null
          notion_page_id?: string | null
          notion_synced_at?: string | null
          organization_id?: string | null
          page_path?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "beta_feedback_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_feedback: {
        Row: {
          created_at: string
          date_key: string
          id: string
          location_id: string
          play_key: string
          severity: number
          verdict: string
        }
        Insert: {
          created_at?: string
          date_key: string
          id?: string
          location_id: string
          play_key: string
          severity?: number
          verdict: string
        }
        Update: {
          created_at?: string
          date_key?: string
          id?: string
          location_id?: string
          play_key?: string
          severity?: number
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_feedback_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
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
          display_label: string | null
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
          display_label?: string | null
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
          display_label?: string | null
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
      daily_briefs: {
        Row: {
          brief: Json
          date_key: string
          fallback: boolean
          generated_at: string
          id: string
          location_id: string
        }
        Insert: {
          brief: Json
          date_key: string
          fallback?: boolean
          generated_at?: string
          id?: string
          location_id: string
        }
        Update: {
          brief?: Json
          date_key?: string
          fallback?: boolean
          generated_at?: string
          id?: string
          location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_briefs_location_id_fkey"
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
      evergreen_dismissals: {
        Row: {
          created_at: string
          dismissed_at: string
          expires_at: string
          id: string
          location_id: string
          play_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dismissed_at?: string
          expires_at: string
          id?: string
          location_id: string
          play_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dismissed_at?: string
          expires_at?: string
          id?: string
          location_id?: string
          play_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evergreen_dismissals_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      evergreen_plays: {
        Row: {
          id: string
          location_id: string
          play: Json
          play_key: string
          saved_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          location_id: string
          play: Json
          play_key: string
          saved_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          location_id?: string
          play?: Json
          play_key?: string
          saved_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evergreen_plays_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      first_brief_sends: {
        Row: {
          location_id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          location_id: string
          sent_at?: string
          user_id: string
        }
        Update: {
          location_id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "first_brief_sends_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "first_brief_sends_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fixtures: {
        Row: {
          aliases: string[]
          city: string | null
          competition_id: string
          created_at: string
          id: string
          label: string | null
          lat: number | null
          lng: number | null
          local_date: string | null
          local_kickoff: string | null
          place_name: string | null
          round: string | null
          tz: string | null
          updated_at: string
          venue_id: string
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          aliases?: string[]
          city?: string | null
          competition_id: string
          created_at?: string
          id?: string
          label?: string | null
          lat?: number | null
          lng?: number | null
          local_date?: string | null
          local_kickoff?: string | null
          place_name?: string | null
          round?: string | null
          tz?: string | null
          updated_at?: string
          venue_id: string
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          aliases?: string[]
          city?: string | null
          competition_id?: string
          created_at?: string
          id?: string
          label?: string | null
          lat?: number | null
          lng?: number | null
          local_date?: string | null
          local_kickoff?: string | null
          place_name?: string | null
          round?: string | null
          tz?: string | null
          updated_at?: string
          venue_id?: string
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      insight_pool_entries: {
        Row: {
          category: string | null
          combined_score: number
          confidence: string | null
          created_at: string
          expires_at: string
          first_seen_date: string
          id: string
          is_top: boolean
          kind: string | null
          last_seen_date: string
          location_id: string
          play: Json
          play_key: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          combined_score?: number
          confidence?: string | null
          created_at?: string
          expires_at: string
          first_seen_date: string
          id?: string
          is_top?: boolean
          kind?: string | null
          last_seen_date: string
          location_id: string
          play: Json
          play_key: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          combined_score?: number
          confidence?: string | null
          created_at?: string
          expires_at?: string
          first_seen_date?: string
          id?: string
          is_top?: boolean
          kind?: string | null
          last_seen_date?: string
          location_id?: string
          play?: Json
          play_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_pool_entries_location_id_fkey"
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
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_status: string
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
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_status?: string
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
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_status?: string
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
      location_busy_times: {
        Row: {
          current_popularity: number | null
          day_of_week: number
          hourly_scores: number[]
          id: string
          location_id: string
          peak_hour: number | null
          peak_score: number | null
          refreshed_at: string
          slow_hours: number[] | null
        }
        Insert: {
          current_popularity?: number | null
          day_of_week: number
          hourly_scores: number[]
          id?: string
          location_id: string
          peak_hour?: number | null
          peak_score?: number | null
          refreshed_at?: string
          slow_hours?: number[] | null
        }
        Update: {
          current_popularity?: number | null
          day_of_week?: number
          hourly_scores?: number[]
          id?: string
          location_id?: string
          peak_hour?: number | null
          peak_score?: number | null
          refreshed_at?: string
          slow_hours?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "location_busy_times_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_density: {
        Row: {
          commercial_proxy: number | null
          location_id: string
          refreshed_at: string
          residential_density: number | null
          source: string
          tier: string
        }
        Insert: {
          commercial_proxy?: number | null
          location_id: string
          refreshed_at?: string
          residential_density?: number | null
          source?: string
          tier?: string
        }
        Update: {
          commercial_proxy?: number | null
          location_id?: string
          refreshed_at?: string
          residential_density?: number | null
          source?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_density_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_photos: {
        Row: {
          analysis_result: Json | null
          author_attribution: Json | null
          created_at: string
          first_seen_at: string
          height_px: number | null
          id: string
          image_hash: string
          image_url: string | null
          last_seen_at: string
          location_id: string
          place_photo_name: string
          snapshot_id: string | null
          width_px: number | null
        }
        Insert: {
          analysis_result?: Json | null
          author_attribution?: Json | null
          created_at?: string
          first_seen_at?: string
          height_px?: number | null
          id?: string
          image_hash: string
          image_url?: string | null
          last_seen_at?: string
          location_id: string
          place_photo_name: string
          snapshot_id?: string | null
          width_px?: number | null
        }
        Update: {
          analysis_result?: Json | null
          author_attribution?: Json | null
          created_at?: string
          first_seen_at?: string
          height_px?: number | null
          id?: string
          image_hash?: string
          image_url?: string | null
          last_seen_at?: string
          location_id?: string
          place_photo_name?: string
          snapshot_id?: string | null
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "location_photos_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_reviews: {
        Row: {
          authenticity_confidence: string | null
          authenticity_rationale: string | null
          authenticity_score: number | null
          author_key: string | null
          author_name: string | null
          created_at: string
          draft_generated_at: string | null
          draft_text: string | null
          first_seen_at: string
          google_maps_uri: string | null
          id: string
          last_seen_at: string
          location_id: string
          operator_verdict: string | null
          operator_verdict_at: string | null
          published_at: string | null
          rating: number | null
          red_flags: Json | null
          relative_published: string | null
          review_text: string | null
          score_version: string | null
          scored_at: string | null
          sentiment_score: number | null
          severity_rationale: string | null
          severity_score: number | null
          source: string
          source_review_id: string
          triage_status: string
          triage_updated_at: string | null
          triage_updated_by: string | null
          updated_at: string
        }
        Insert: {
          authenticity_confidence?: string | null
          authenticity_rationale?: string | null
          authenticity_score?: number | null
          author_key?: string | null
          author_name?: string | null
          created_at?: string
          draft_generated_at?: string | null
          draft_text?: string | null
          first_seen_at?: string
          google_maps_uri?: string | null
          id?: string
          last_seen_at?: string
          location_id: string
          operator_verdict?: string | null
          operator_verdict_at?: string | null
          published_at?: string | null
          rating?: number | null
          red_flags?: Json | null
          relative_published?: string | null
          review_text?: string | null
          score_version?: string | null
          scored_at?: string | null
          sentiment_score?: number | null
          severity_rationale?: string | null
          severity_score?: number | null
          source?: string
          source_review_id: string
          triage_status?: string
          triage_updated_at?: string | null
          triage_updated_by?: string | null
          updated_at?: string
        }
        Update: {
          authenticity_confidence?: string | null
          authenticity_rationale?: string | null
          authenticity_score?: number | null
          author_key?: string | null
          author_name?: string | null
          created_at?: string
          draft_generated_at?: string | null
          draft_text?: string | null
          first_seen_at?: string
          google_maps_uri?: string | null
          id?: string
          last_seen_at?: string
          location_id?: string
          operator_verdict?: string | null
          operator_verdict_at?: string | null
          published_at?: string | null
          rating?: number | null
          red_flags?: Json | null
          relative_published?: string | null
          review_text?: string | null
          score_version?: string | null
          scored_at?: string | null
          sentiment_score?: number | null
          severity_rationale?: string | null
          severity_score?: number | null
          source?: string
          source_review_id?: string
          triage_status?: string
          triage_updated_at?: string | null
          triage_updated_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_reviews_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_snapshots: {
        Row: {
          captured_at: string
          content_as_of: string | null
          created_at: string
          date_key: string
          diff_hash: string
          freshness: string
          id: string
          location_id: string
          provider: string
          raw_data: Json
        }
        Insert: {
          captured_at: string
          content_as_of?: string | null
          created_at?: string
          date_key: string
          diff_hash: string
          freshness?: string
          id?: string
          location_id: string
          provider: string
          raw_data: Json
        }
        Update: {
          captured_at?: string
          content_as_of?: string | null
          created_at?: string
          date_key?: string
          diff_hash?: string
          freshness?: string
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
          brand_tolerance: number
          city: string | null
          country: string | null
          created_at: string
          daily_runs_enabled: boolean
          generosity_threshold: number
          geo_lat: number | null
          geo_lng: number | null
          id: string
          name: string
          organization_id: string
          postal_code: string | null
          primary_place_id: string | null
          region: string | null
          settings: Json
          standing_question: string | null
          timezone: string
          updated_at: string
          voice_tone: string | null
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          brand_tolerance?: number
          city?: string | null
          country?: string | null
          created_at?: string
          daily_runs_enabled?: boolean
          generosity_threshold?: number
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          name: string
          organization_id: string
          postal_code?: string | null
          primary_place_id?: string | null
          region?: string | null
          settings?: Json
          standing_question?: string | null
          timezone?: string
          updated_at?: string
          voice_tone?: string | null
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          brand_tolerance?: number
          city?: string | null
          country?: string | null
          created_at?: string
          daily_runs_enabled?: boolean
          generosity_threshold?: number
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          name?: string
          organization_id?: string
          postal_code?: string | null
          primary_place_id?: string | null
          region?: string | null
          settings?: Json
          standing_question?: string | null
          timezone?: string
          updated_at?: string
          voice_tone?: string | null
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
      menu_ingest_events: {
        Row: {
          competitor_id: string | null
          coverage_ratio: number | null
          created_at: string
          date_key: string
          failure_reason: string | null
          historical_high_items: number | null
          id: string
          items_total: number
          location_id: string | null
          outcome: string
          run_source: string
          sources: Json
          stages: Json
          target: string
        }
        Insert: {
          competitor_id?: string | null
          coverage_ratio?: number | null
          created_at?: string
          date_key: string
          failure_reason?: string | null
          historical_high_items?: number | null
          id?: string
          items_total?: number
          location_id?: string | null
          outcome: string
          run_source: string
          sources?: Json
          stages?: Json
          target: string
        }
        Update: {
          competitor_id?: string | null
          coverage_ratio?: number | null
          created_at?: string
          date_key?: string
          failure_reason?: string | null
          historical_high_items?: number | null
          id?: string
          items_total?: number
          location_id?: string | null
          outcome?: string
          run_source?: string
          sources?: Json
          stages?: Json
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_ingest_events_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_ingest_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_brief_backup_20260717: {
        Row: {
          brief: Json | null
          date_key: string | null
          fallback: boolean | null
          generated_at: string | null
          id: string | null
          location_id: string | null
        }
        Insert: {
          brief?: Json | null
          date_key?: string | null
          fallback?: boolean | null
          generated_at?: string | null
          id?: string | null
          location_id?: string | null
        }
        Update: {
          brief?: Json | null
          date_key?: string | null
          fallback?: boolean | null
          generated_at?: string | null
          id?: string | null
          location_id?: string | null
        }
        Relationships: []
      }
      ops_brief_backup_20260717b: {
        Row: {
          brief: Json | null
          date_key: string | null
          fallback: boolean | null
          generated_at: string | null
          id: string | null
          location_id: string | null
        }
        Insert: {
          brief?: Json | null
          date_key?: string | null
          fallback?: boolean | null
          generated_at?: string | null
          id?: string | null
          location_id?: string | null
        }
        Update: {
          brief?: Json | null
          date_key?: string | null
          fallback?: boolean | null
          generated_at?: string | null
          id?: string | null
          location_id?: string | null
        }
        Relationships: []
      }
      ops_cleanup_backup_20260810: {
        Row: {
          backed_up_at: string | null
          billing_email: string | null
          billing_email_token_expires_at: string | null
          billing_email_token_hash: string | null
          billing_email_token_sent_at: string | null
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          deleted_at: string | null
          display_name: string | null
          id: string | null
          industry_type: string | null
          members_snapshot: string | null
          name: string | null
          org_kind: string | null
          payment_state: string | null
          pending_billing_email: string | null
          settings: Json | null
          slug: string | null
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          subscription_tier: string | null
          trial_ends_at: string | null
          trial_started_at: string | null
          updated_at: string | null
          waitlist_signup_id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          billing_email?: string | null
          billing_email_token_expires_at?: string | null
          billing_email_token_hash?: string | null
          billing_email_token_sent_at?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          deleted_at?: string | null
          display_name?: string | null
          id?: string | null
          industry_type?: string | null
          members_snapshot?: string | null
          name?: string | null
          org_kind?: string | null
          payment_state?: string | null
          pending_billing_email?: string | null
          settings?: Json | null
          slug?: string | null
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          subscription_tier?: string | null
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string | null
          waitlist_signup_id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          billing_email?: string | null
          billing_email_token_expires_at?: string | null
          billing_email_token_hash?: string | null
          billing_email_token_sent_at?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          deleted_at?: string | null
          display_name?: string | null
          id?: string | null
          industry_type?: string | null
          members_snapshot?: string | null
          name?: string | null
          org_kind?: string | null
          payment_state?: string | null
          pending_billing_email?: string | null
          settings?: Json | null
          slug?: string | null
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          subscription_tier?: string | null
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string | null
          waitlist_signup_id?: string | null
        }
        Relationships: []
      }
      ops_cull_backup_20260812: {
        Row: {
          backed_up_at: string
          entity_id: string
          entity_type: string
          payload: Json
        }
        Insert: {
          backed_up_at?: string
          entity_id: string
          entity_type: string
          payload: Json
        }
        Update: {
          backed_up_at?: string
          entity_id?: string
          entity_type?: string
          payload?: Json
        }
        Relationships: []
      }
      ops_model_ab_20260812: {
        Row: {
          label: string | null
          payload: Json | null
          saved_at: string | null
        }
        Insert: {
          label?: string | null
          payload?: Json | null
          saved_at?: string | null
        }
        Update: {
          label?: string | null
          payload?: Json | null
          saved_at?: string | null
        }
        Relationships: []
      }
      ops_org_kind_backup_20260813: {
        Row: {
          backed_up_at: string | null
          id: string | null
          name: string | null
          org_kind: string | null
          payment_state: string | null
          subscription_tier: string | null
          trial_ends_at: string | null
        }
        Insert: {
          backed_up_at?: string | null
          id?: string | null
          name?: string | null
          org_kind?: string | null
          payment_state?: string | null
          subscription_tier?: string | null
          trial_ends_at?: string | null
        }
        Update: {
          backed_up_at?: string | null
          id?: string | null
          name?: string | null
          org_kind?: string | null
          payment_state?: string | null
          subscription_tier?: string | null
          trial_ends_at?: string | null
        }
        Relationships: []
      }
      org_access_requests: {
        Row: {
          contact_info: string | null
          created_at: string
          escalated_at: string | null
          id: string
          kind: string
          message: string | null
          nudged_at: string | null
          organization_id: string
          place_id: string
          requester_email: string | null
          requester_name: string | null
          requester_user_id: string
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          contact_info?: string | null
          created_at?: string
          escalated_at?: string | null
          id?: string
          kind?: string
          message?: string | null
          nudged_at?: string | null
          organization_id: string
          place_id: string
          requester_email?: string | null
          requester_name?: string | null
          requester_user_id: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          contact_info?: string | null
          created_at?: string
          escalated_at?: string | null
          id?: string
          kind?: string
          message?: string | null
          nudged_at?: string | null
          organization_id?: string
          place_id?: string
          requester_email?: string | null
          requester_name?: string | null
          requester_user_id?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_access_requests_organization_id_fkey"
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
          billing_email_token_expires_at: string | null
          billing_email_token_hash: string | null
          billing_email_token_sent_at: string | null
          cancel_at_period_end: boolean
          competitors_purchased: number
          created_at: string
          current_period_end: string | null
          deleted_at: string | null
          display_name: string | null
          id: string
          industry_type: string
          locations_purchased: number
          name: string
          org_kind: string
          payment_state: string | null
          pending_billing_email: string | null
          settings: Json
          slug: string
          stripe_customer_id: string | null
          stripe_event_created: number | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          subscription_tier: string
          trial_ends_at: string | null
          trial_started_at: string | null
          updated_at: string
          waitlist_signup_id: string | null
        }
        Insert: {
          billing_email?: string | null
          billing_email_token_expires_at?: string | null
          billing_email_token_hash?: string | null
          billing_email_token_sent_at?: string | null
          cancel_at_period_end?: boolean
          competitors_purchased?: number
          created_at?: string
          current_period_end?: string | null
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          industry_type?: string
          locations_purchased?: number
          name: string
          org_kind?: string
          payment_state?: string | null
          pending_billing_email?: string | null
          settings?: Json
          slug: string
          stripe_customer_id?: string | null
          stripe_event_created?: number | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          subscription_tier?: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
          waitlist_signup_id?: string | null
        }
        Update: {
          billing_email?: string | null
          billing_email_token_expires_at?: string | null
          billing_email_token_hash?: string | null
          billing_email_token_sent_at?: string | null
          cancel_at_period_end?: boolean
          competitors_purchased?: number
          created_at?: string
          current_period_end?: string | null
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          industry_type?: string
          locations_purchased?: number
          name?: string
          org_kind?: string
          payment_state?: string | null
          pending_billing_email?: string | null
          settings?: Json
          slug?: string
          stripe_customer_id?: string | null
          stripe_event_created?: number | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          subscription_tier?: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
          waitlist_signup_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_waitlist_signup_id_fkey"
            columns: ["waitlist_signup_id"]
            isOneToOne: false
            referencedRelation: "waitlist_signups"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_catalog: {
        Row: {
          created_at: string
          distance_mi: number | null
          id: string
          lat: number | null
          lng: number | null
          location_id: string
          name: string
          partner_type: string
          place_id: string | null
          primary_type: string | null
          refreshed_at: string
          size_band: string
          size_confidence: string
          size_proxy_high: number | null
          size_proxy_kind: string | null
          size_proxy_low: number | null
        }
        Insert: {
          created_at?: string
          distance_mi?: number | null
          id?: string
          lat?: number | null
          lng?: number | null
          location_id: string
          name: string
          partner_type: string
          place_id?: string | null
          primary_type?: string | null
          refreshed_at?: string
          size_band?: string
          size_confidence?: string
          size_proxy_high?: number | null
          size_proxy_kind?: string | null
          size_proxy_low?: number | null
        }
        Update: {
          created_at?: string
          distance_mi?: number | null
          id?: string
          lat?: number | null
          lng?: number | null
          location_id?: string
          name?: string
          partner_type?: string
          place_id?: string | null
          primary_type?: string | null
          refreshed_at?: string
          size_band?: string
          size_confidence?: string
          size_proxy_high?: number | null
          size_proxy_kind?: string | null
          size_proxy_low?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_catalog_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          competitor_id: string | null
          created_at: string
          finished_at: string | null
          id: string
          location_id: string
          outcome: string
          pipeline: string
          reason: string | null
          run_id: string
          signals: Json
          started_at: string
        }
        Insert: {
          competitor_id?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          location_id: string
          outcome: string
          pipeline: string
          reason?: string | null
          run_id: string
          signals?: Json
          started_at?: string
        }
        Update: {
          competitor_id?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          location_id?: string
          outcome?: string
          pipeline?: string
          reason?: string | null
          run_id?: string
          signals?: Json
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_runs_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_runs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string | null
          email: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      play_actions: {
        Row: {
          action: string
          created_at: string
          date_key: string
          id: string
          location_id: string
          note: string | null
          play_key: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_status: string
          updated_at: string
        }
        Insert: {
          action: string
          created_at?: string
          date_key: string
          id?: string
          location_id: string
          note?: string | null
          play_key: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_status?: string
          updated_at?: string
        }
        Update: {
          action?: string
          created_at?: string
          date_key?: string
          id?: string
          location_id?: string
          note?: string | null
          play_key?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "play_actions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          current_organization_id: string | null
          email: string | null
          full_name: string | null
          id: string
          last_seen_at: string | null
          updated_at: string
          weekly_digest_day: number
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          current_organization_id?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          last_seen_at?: string | null
          updated_at?: string
          weekly_digest_day?: number
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          current_organization_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          last_seen_at?: string | null
          updated_at?: string
          weekly_digest_day?: number
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
      review_watch_events: {
        Row: {
          anomaly_key: string
          cooldown_until: string
          created_at: string
          detail: Json
          direction: string
          fired_on: string
          kind: string
          location_id: string
          strength: number
        }
        Insert: {
          anomaly_key: string
          cooldown_until: string
          created_at?: string
          detail?: Json
          direction: string
          fired_on: string
          kind: string
          location_id: string
          strength: number
        }
        Update: {
          anomaly_key?: string
          cooldown_until?: string
          created_at?: string
          detail?: Json
          direction?: string
          fired_on?: string
          kind?: string
          location_id?: string
          strength?: number
        }
        Relationships: [
          {
            foreignKeyName: "review_watch_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_jobs: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          cursor: Json | null
          id: string
          last_error: string | null
          location_id: string
          max_attempts: number
          organization_id: string
          pipeline: string
          run_id: string
          scheduled_for: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          cursor?: Json | null
          id?: string
          last_error?: string | null
          location_id: string
          max_attempts?: number
          organization_id: string
          pipeline: string
          run_id: string
          scheduled_for?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          cursor?: Json | null
          id?: string
          last_error?: string | null
          location_id?: string
          max_attempts?: number
          organization_id?: string
          pipeline?: string
          run_id?: string
          scheduled_for?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_jobs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_feedback_rollup: {
        Row: {
          bad_count: number
          bad_weighted: number
          bayes_score: number
          created_at: string
          good_count: number
          good_weighted: number
          id: string
          last_recompute: string
          multiplier: number
          org_support_n: number
          play_type_key: string
          scope: string
          scope_id: string | null
          skill_id: string
          support_n: number
          updated_at: string
        }
        Insert: {
          bad_count?: number
          bad_weighted?: number
          bayes_score?: number
          created_at?: string
          good_count?: number
          good_weighted?: number
          id?: string
          last_recompute?: string
          multiplier?: number
          org_support_n?: number
          play_type_key: string
          scope?: string
          scope_id?: string | null
          skill_id: string
          support_n?: number
          updated_at?: string
        }
        Update: {
          bad_count?: number
          bad_weighted?: number
          bayes_score?: number
          created_at?: string
          good_count?: number
          good_weighted?: number
          id?: string
          last_recompute?: string
          multiplier?: number
          org_support_n?: number
          play_type_key?: string
          scope?: string
          scope_id?: string | null
          skill_id?: string
          support_n?: number
          updated_at?: string
        }
        Relationships: []
      }
      skill_knowledge: {
        Row: {
          confidence: number
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          knowledge_version: string
          learning_kind: string
          provenance: Json
          scope: string
          scope_id: string | null
          skill_id: string
          snippet: string
          status: string
          support_n: number
          title: string
          updated_at: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          knowledge_version: string
          learning_kind: string
          provenance?: Json
          scope?: string
          scope_id?: string | null
          skill_id: string
          snippet: string
          status?: string
          support_n?: number
          title: string
          updated_at?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          knowledge_version?: string
          learning_kind?: string
          provenance?: Json
          scope?: string
          scope_id?: string | null
          skill_id?: string
          snippet?: string
          status?: string
          support_n?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      skill_source_registry: {
        Row: {
          auth_kind: string
          created_at: string
          enabled: boolean
          failure_count: number
          fetch_strategy: string
          id: string
          last_fetch: string | null
          last_status: string | null
          name: string
          skill_ids: string[]
          trust_tier: number
          updated_at: string
          url: string
          vertical: string
        }
        Insert: {
          auth_kind?: string
          created_at?: string
          enabled?: boolean
          failure_count?: number
          fetch_strategy?: string
          id?: string
          last_fetch?: string | null
          last_status?: string | null
          name: string
          skill_ids?: string[]
          trust_tier?: number
          updated_at?: string
          url: string
          vertical: string
        }
        Update: {
          auth_kind?: string
          created_at?: string
          enabled?: boolean
          failure_count?: number
          fetch_strategy?: string
          id?: string
          last_fetch?: string | null
          last_status?: string | null
          name?: string
          skill_ids?: string[]
          trust_tier?: number
          updated_at?: string
          url?: string
          vertical?: string
        }
        Relationships: []
      }
      snapshots: {
        Row: {
          captured_at: string
          competitor_id: string
          content_as_of: string | null
          created_at: string
          date_key: string
          diff_hash: string
          freshness: string
          id: string
          provider: string
          raw_data: Json
          snapshot_type: string
        }
        Insert: {
          captured_at: string
          competitor_id: string
          content_as_of?: string | null
          created_at?: string
          date_key: string
          diff_hash: string
          freshness?: string
          id?: string
          provider: string
          raw_data: Json
          snapshot_type?: string
        }
        Update: {
          captured_at?: string
          competitor_id?: string
          content_as_of?: string | null
          created_at?: string
          date_key?: string
          diff_hash?: string
          freshness?: string
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
          content_as_of: string | null
          created_at: string
          date_key: string
          diff_hash: string
          freshness: string
          id: string
          raw_data: Json
          social_profile_id: string
        }
        Insert: {
          captured_at: string
          content_as_of?: string | null
          created_at?: string
          date_key: string
          diff_hash: string
          freshness?: string
          id?: string
          raw_data: Json
          social_profile_id: string
        }
        Update: {
          captured_at?: string
          content_as_of?: string | null
          created_at?: string
          date_key?: string
          diff_hash?: string
          freshness?: string
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
      stripe_events: {
        Row: {
          brand: string | null
          cadence: string | null
          error_message: string | null
          event_id: string
          event_type: string
          organization_id: string | null
          payload: Json
          price_id: string | null
          received_at: string
          skipped_reason: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tier: string | null
          warning: string | null
        }
        Insert: {
          brand?: string | null
          cadence?: string | null
          error_message?: string | null
          event_id: string
          event_type: string
          organization_id?: string | null
          payload: Json
          price_id?: string | null
          received_at?: string
          skipped_reason?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string | null
          warning?: string | null
        }
        Update: {
          brand?: string | null
          cadence?: string | null
          error_message?: string | null
          event_id?: string
          event_type?: string
          organization_id?: string | null
          payload?: Json
          price_id?: string | null
          received_at?: string
          skipped_reason?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string | null
          warning?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stripe_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          error: string | null
          event_id: string
          event_type: string
          processed_at: string | null
          received_at: string
        }
        Insert: {
          error?: string | null
          event_id: string
          event_type: string
          processed_at?: string | null
          received_at?: string
        }
        Update: {
          error?: string | null
          event_id?: string
          event_type?: string
          processed_at?: string | null
          received_at?: string
        }
        Relationships: []
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
      trial_reminder_sends: {
        Row: {
          organization_id: string
          reminder_day: number
          sent_at: string
        }
        Insert: {
          organization_id: string
          reminder_day: number
          sent_at?: string
        }
        Update: {
          organization_id?: string
          reminder_day?: number
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trial_reminder_sends_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_catalog: {
        Row: {
          aliases: string[]
          capacity_confidence: string
          capacity_high: number | null
          capacity_low: number | null
          created_at: string
          distance_mi: number | null
          id: string
          lat: number | null
          lng: number | null
          location_id: string
          name: string
          place_id: string | null
          primary_type: string | null
          refreshed_at: string
        }
        Insert: {
          aliases?: string[]
          capacity_confidence?: string
          capacity_high?: number | null
          capacity_low?: number | null
          created_at?: string
          distance_mi?: number | null
          id?: string
          lat?: number | null
          lng?: number | null
          location_id: string
          name: string
          place_id?: string | null
          primary_type?: string | null
          refreshed_at?: string
        }
        Update: {
          aliases?: string[]
          capacity_confidence?: string
          capacity_high?: number | null
          capacity_low?: number | null
          created_at?: string
          distance_mi?: number | null
          id?: string
          lat?: number | null
          lng?: number | null
          location_id?: string
          name?: string
          place_id?: string | null
          primary_type?: string | null
          refreshed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_catalog_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_geocode_cache: {
        Row: {
          lat: number
          lng: number
          query_key: string
          resolved_at: string
          website: string | null
        }
        Insert: {
          lat: number
          lng: number
          query_key: string
          resolved_at?: string
          website?: string | null
        }
        Update: {
          lat?: number
          lng?: number
          query_key?: string
          resolved_at?: string
          website?: string | null
        }
        Relationships: []
      }
      waitlist_signups: {
        Row: {
          admin_notes: string | null
          business_name: string | null
          city: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          notes: string | null
          referred_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          business_name?: string | null
          city?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          referred_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          business_name?: string | null
          city?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          referred_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      weekly_digest_sends: {
        Row: {
          date_key: string
          location_id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          date_key: string
          location_id: string
          sent_at?: string
          user_id: string
        }
        Update: {
          date_key?: string
          location_id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_digest_sends_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_digest_sends_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cascade_delete_organization: {
        Args: { p_keep_shell?: boolean; p_org_id: string }
        Returns: Json
      }
      claim_signal_jobs: {
        Args: { batch: number }
        Returns: {
          attempts: number
          claimed_at: string | null
          created_at: string
          cursor: Json | null
          id: string
          last_error: string | null
          location_id: string
          max_attempts: number
          organization_id: string
          pipeline: string
          run_id: string
          scheduled_for: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "signal_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
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
