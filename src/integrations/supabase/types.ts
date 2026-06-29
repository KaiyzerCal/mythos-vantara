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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      a2a_tasks: {
        Row: {
          artifacts: Json | null
          completed_at: string | null
          created_at: string | null
          external_agent_id: string | null
          id: string
          input_message: string
          output_message: string | null
          skill_id: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          artifacts?: Json | null
          completed_at?: string | null
          created_at?: string | null
          external_agent_id?: string | null
          id?: string
          input_message: string
          output_message?: string | null
          skill_id: string
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          artifacts?: Json | null
          completed_at?: string | null
          created_at?: string | null
          external_agent_id?: string | null
          id?: string
          input_message?: string
          output_message?: string | null
          skill_id?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      activity_log: {
        Row: {
          created_at: string
          description: string
          event_type: string
          id: string
          user_id: string
          xp_amount: number
        }
        Insert: {
          created_at?: string
          description: string
          event_type: string
          id?: string
          user_id: string
          xp_amount?: number
        }
        Update: {
          created_at?: string
          description?: string
          event_type?: string
          id?: string
          user_id?: string
          xp_amount?: number
        }
        Relationships: []
      }
      agent_telegram_config: {
        Row: {
          active: boolean | null
          agent_id: string
          agent_type: string
          bot_token: string | null
          chat_id: string | null
          created_at: string | null
          id: string
          user_id: string
          webhook_url: string | null
        }
        Insert: {
          active?: boolean | null
          agent_id: string
          agent_type: string
          bot_token?: string | null
          chat_id?: string | null
          created_at?: string | null
          id?: string
          user_id: string
          webhook_url?: string | null
        }
        Update: {
          active?: boolean | null
          agent_id?: string
          agent_type?: string
          bot_token?: string | null
          chat_id?: string | null
          created_at?: string | null
          id?: string
          user_id?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      allies: {
        Row: {
          affinity: number
          avatar: string | null
          created_at: string
          id: string
          level: number
          name: string
          notes: string
          relationship: string
          specialty: string
          updated_at: string
          user_id: string
        }
        Insert: {
          affinity?: number
          avatar?: string | null
          created_at?: string
          id?: string
          level?: number
          name: string
          notes?: string
          relationship?: string
          specialty?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          affinity?: number
          avatar?: string | null
          created_at?: string
          id?: string
          level?: number
          name?: string
          notes?: string
          relationship?: string
          specialty?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      approvals: {
        Row: {
          action_payload: Json
          action_summary: string
          action_type: string
          created_at: string
          expires_at: string | null
          id: string
          resolved_at: string | null
          status: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          action_payload: Json
          action_summary: string
          action_type: string
          created_at?: string
          expires_at?: string | null
          id?: string
          resolved_at?: string | null
          status?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          action_payload?: Json
          action_summary?: string
          action_type?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          resolved_at?: string | null
          status?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approvals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      artifacts: {
        Row: {
          artifact_type: string
          content: string
          created_at: string
          id: string
          metadata: Json
          tags: string[]
          title: string
          updated_at: string
          user_id: string
          version: number
          workspace_id: string | null
        }
        Insert: {
          artifact_type?: string
          content?: string
          created_at?: string
          id?: string
          metadata?: Json
          tags?: string[]
          title: string
          updated_at?: string
          user_id: string
          version?: number
          workspace_id?: string | null
        }
        Update: {
          artifact_type?: string
          content?: string
          created_at?: string
          id?: string
          metadata?: Json
          tags?: string[]
          title?: string
          updated_at?: string
          user_id?: string
          version?: number
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bpm_sessions: {
        Row: {
          bpm: number
          created_at: string
          duration: number
          form: string
          id: string
          mood: string | null
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bpm: number
          created_at?: string
          duration?: number
          form?: string
          id?: string
          mood?: string | null
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bpm?: number
          created_at?: string
          duration?: number
          form?: string
          id?: string
          mood?: string | null
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_attachments: {
        Row: {
          chat_kind: string
          created_at: string
          error_message: string | null
          extracted_text: string
          file_name: string
          file_size: number
          file_type: string
          file_url: string
          id: string
          metadata: Json
          mime_type: string
          processing_status: string
          storage_path: string
          thread_ref: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_kind: string
          created_at?: string
          error_message?: string | null
          extracted_text?: string
          file_name: string
          file_size?: number
          file_type?: string
          file_url: string
          id?: string
          metadata?: Json
          mime_type?: string
          processing_status?: string
          storage_path: string
          thread_ref: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_kind?: string
          created_at?: string
          error_message?: string | null
          extracted_text?: string
          file_name?: string
          file_size?: number
          file_type?: string
          file_url?: string
          id?: string
          metadata?: Json
          mime_type?: string
          processing_status?: string
          storage_path?: string
          thread_ref?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          mode: string | null
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          mode?: string | null
          role?: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          mode?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      code_delegation_sessions: {
        Row: {
          created_at: string | null
          external_session_id: string | null
          id: string
          messages: Json | null
          provider: string
          prs_created: Json | null
          session_url: string | null
          status: string
          task_description: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          external_session_id?: string | null
          id?: string
          messages?: Json | null
          provider?: string
          prs_created?: Json | null
          session_url?: string | null
          status?: string
          task_description: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          external_session_id?: string | null
          id?: string
          messages?: Json | null
          provider?: string
          prs_created?: Json | null
          session_url?: string | null
          status?: string
          task_description?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      computer_use_tasks: {
        Row: {
          actions_taken: Json | null
          completed_at: string | null
          created_at: string | null
          id: string
          model: string
          result: string | null
          status: string
          task_description: string
          user_id: string
        }
        Insert: {
          actions_taken?: Json | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          model?: string
          result?: string | null
          status?: string
          task_description: string
          user_id: string
        }
        Update: {
          actions_taken?: Json | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          model?: string
          result?: string | null
          status?: string
          task_description?: string
          user_id?: string
        }
        Relationships: []
      }
      contact_interactions: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          interaction_type: string | null
          notes: string
          sentiment: string | null
          user_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          interaction_type?: string | null
          notes?: string
          sentiment?: string | null
          user_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          interaction_type?: string | null
          notes?: string
          sentiment?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          follow_up_date: string | null
          id: string
          interaction_count: number | null
          last_contact_at: string | null
          name: string
          notes: string | null
          phone: string | null
          profile: Json | null
          relationship_type: string | null
          source: string | null
          tags: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          follow_up_date?: string | null
          id?: string
          interaction_count?: number | null
          last_contact_at?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          profile?: Json | null
          relationship_type?: string | null
          source?: string | null
          tags?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          follow_up_date?: string | null
          id?: string
          interaction_count?: number | null
          last_contact_at?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          profile?: Json | null
          relationship_type?: string | null
          source?: string | null
          tags?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      council_chat_messages: {
        Row: {
          content: string
          council_member_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          council_member_id: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          content?: string
          council_member_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "council_chat_messages_council_member_id_fkey"
            columns: ["council_member_id"]
            isOneToOne: false
            referencedRelation: "councils"
            referencedColumns: ["id"]
          },
        ]
      }
      council_group_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          session_id: string
          speaker_id: string | null
          speaker_name: string
          speaker_role: string | null
          speaker_type: string
          turn_number: number | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          session_id: string
          speaker_id?: string | null
          speaker_name: string
          speaker_role?: string | null
          speaker_type: string
          turn_number?: number | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          session_id?: string
          speaker_id?: string | null
          speaker_name?: string
          speaker_role?: string | null
          speaker_type?: string
          turn_number?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "council_group_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "council_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      council_sessions: {
        Row: {
          active: boolean | null
          created_at: string | null
          ended_at: string | null
          id: string
          messages: Json | null
          parent_session_id: string | null
          participants: Json | null
          session_type: string | null
          started_at: string | null
          summary: string | null
          topic: string | null
          turn_count: number | null
          updated_at: string | null
          user_id: string
          voice_mode: boolean | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          ended_at?: string | null
          id?: string
          messages?: Json | null
          parent_session_id?: string | null
          participants?: Json | null
          session_type?: string | null
          started_at?: string | null
          summary?: string | null
          topic?: string | null
          turn_count?: number | null
          updated_at?: string | null
          user_id: string
          voice_mode?: boolean | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          ended_at?: string | null
          id?: string
          messages?: Json | null
          parent_session_id?: string | null
          participants?: Json | null
          session_type?: string | null
          started_at?: string | null
          summary?: string | null
          topic?: string | null
          turn_count?: number | null
          updated_at?: string | null
          user_id?: string
          voice_mode?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "council_sessions_parent_session_id_fkey"
            columns: ["parent_session_id"]
            isOneToOne: false
            referencedRelation: "council_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      councils: {
        Row: {
          agent_folders: Json
          avatar: string | null
          can_be_summoned: boolean | null
          class: string
          created_at: string
          data_access_tier: string | null
          id: string
          last_used_at: string | null
          name: string
          notes: string
          personality_prompt: string | null
          role: string
          specialty: string | null
          tactic_state: string
          telegram_enabled: boolean | null
          timezone: string | null
          updated_at: string
          user_id: string
          voice_id: string | null
          voice_settings: Json
          voice_style: string | null
        }
        Insert: {
          agent_folders?: Json
          avatar?: string | null
          can_be_summoned?: boolean | null
          class?: string
          created_at?: string
          data_access_tier?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          notes?: string
          personality_prompt?: string | null
          role?: string
          specialty?: string | null
          tactic_state?: string
          telegram_enabled?: boolean | null
          timezone?: string | null
          updated_at?: string
          user_id: string
          voice_id?: string | null
          voice_settings?: Json
          voice_style?: string | null
        }
        Update: {
          agent_folders?: Json
          avatar?: string | null
          can_be_summoned?: boolean | null
          class?: string
          created_at?: string
          data_access_tier?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          notes?: string
          personality_prompt?: string | null
          role?: string
          specialty?: string | null
          tactic_state?: string
          telegram_enabled?: boolean | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
          voice_id?: string | null
          voice_settings?: Json
          voice_style?: string | null
        }
        Relationships: []
      }
      currencies: {
        Row: {
          amount: number
          created_at: string
          icon: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          icon?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          icon?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_agent_messages: {
        Row: {
          agent_id: string
          content: string
          id: string
          role: string
          session_id: string
          ts: string | null
        }
        Insert: {
          agent_id: string
          content: string
          id?: string
          role: string
          session_id: string
          ts?: string | null
        }
        Update: {
          agent_id?: string
          content?: string
          id?: string
          role?: string
          session_id?: string
          ts?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_agent_messages_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "customer_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_agents: {
        Row: {
          agent_name: string
          agent_persona: string
          brand_color: string | null
          brand_name: string | null
          business_name: string
          business_type: string | null
          capabilities: string[] | null
          created_at: string | null
          customer_email: string | null
          customer_name: string
          deploy_slug: string | null
          embed_token: string | null
          id: string
          knowledge_base: string | null
          logo_url: string | null
          monthly_price_cents: number | null
          plan_tier: string
          status: string
          tone: string | null
          total_conversations: number | null
          total_messages: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          agent_name?: string
          agent_persona: string
          brand_color?: string | null
          brand_name?: string | null
          business_name: string
          business_type?: string | null
          capabilities?: string[] | null
          created_at?: string | null
          customer_email?: string | null
          customer_name: string
          deploy_slug?: string | null
          embed_token?: string | null
          id?: string
          knowledge_base?: string | null
          logo_url?: string | null
          monthly_price_cents?: number | null
          plan_tier?: string
          status?: string
          tone?: string | null
          total_conversations?: number | null
          total_messages?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          agent_name?: string
          agent_persona?: string
          brand_color?: string | null
          brand_name?: string | null
          business_name?: string
          business_type?: string | null
          capabilities?: string[] | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string
          deploy_slug?: string | null
          embed_token?: string | null
          id?: string
          knowledge_base?: string | null
          logo_url?: string | null
          monthly_price_cents?: number | null
          plan_tier?: string
          status?: string
          tone?: string | null
          total_conversations?: number | null
          total_messages?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      energy_systems: {
        Row: {
          color: string
          current_value: number
          description: string
          id: string
          max_value: number
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          current_value?: number
          description?: string
          id?: string
          max_value?: number
          status?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          current_value?: number
          description?: string
          id?: string
          max_value?: number
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      era_financial_cache: {
        Row: {
          cache_type: string
          data: Json
          id: string
          period_end: string | null
          period_start: string | null
          synced_at: string | null
          user_id: string
        }
        Insert: {
          cache_type: string
          data?: Json
          id?: string
          period_end?: string | null
          period_start?: string | null
          synced_at?: string | null
          user_id: string
        }
        Update: {
          cache_type?: string
          data?: Json
          id?: string
          period_end?: string | null
          period_start?: string | null
          synced_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      galaxy_ring_daily_data: {
        Row: {
          active_calories: number | null
          cognitive_score: number | null
          date: string
          hrv_rmssd: number | null
          id: string
          raw_data: Json | null
          skin_temp_c: number | null
          sleep_score: number | null
          spo2: number | null
          steps: number | null
          stress_level: number | null
          synced_at: string | null
          user_id: string
        }
        Insert: {
          active_calories?: number | null
          cognitive_score?: number | null
          date: string
          hrv_rmssd?: number | null
          id?: string
          raw_data?: Json | null
          skin_temp_c?: number | null
          sleep_score?: number | null
          spo2?: number | null
          steps?: number | null
          stress_level?: number | null
          synced_at?: string | null
          user_id: string
        }
        Update: {
          active_calories?: number | null
          cognitive_score?: number | null
          date?: string
          hrv_rmssd?: number | null
          id?: string
          raw_data?: Json | null
          skin_temp_c?: number | null
          sleep_score?: number | null
          spo2?: number | null
          steps?: number | null
          stress_level?: number | null
          synced_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      game_master_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          metadata: Json | null
          narrative: string | null
          quest_ids: string[] | null
          title: string
          user_id: string
          xp_delta: number | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          narrative?: string | null
          quest_ids?: string[] | null
          title: string
          user_id: string
          xp_delta?: number | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          narrative?: string | null
          quest_ids?: string[] | null
          title?: string
          user_id?: string
          xp_delta?: number | null
        }
        Relationships: []
      }
      health_integration_settings: {
        Row: {
          auto_sync_interval_hours: number | null
          created_at: string | null
          galaxy_ring_enabled: boolean | null
          oura_enabled: boolean | null
          sync_to_mavis_context: boolean | null
          updated_at: string | null
          user_id: string
          whoop_enabled: boolean | null
        }
        Insert: {
          auto_sync_interval_hours?: number | null
          created_at?: string | null
          galaxy_ring_enabled?: boolean | null
          oura_enabled?: boolean | null
          sync_to_mavis_context?: boolean | null
          updated_at?: string | null
          user_id: string
          whoop_enabled?: boolean | null
        }
        Update: {
          auto_sync_interval_hours?: number | null
          created_at?: string | null
          galaxy_ring_enabled?: boolean | null
          oura_enabled?: boolean | null
          sync_to_mavis_context?: boolean | null
          updated_at?: string | null
          user_id?: string
          whoop_enabled?: boolean | null
        }
        Relationships: []
      }
      inventory: {
        Row: {
          description: string
          effect: string | null
          id: string
          is_equipped: boolean
          name: string
          obtained_at: string
          quantity: number
          rarity: string
          slot: string | null
          stat_effects: Json
          tier: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          description?: string
          effect?: string | null
          id?: string
          is_equipped?: boolean
          name: string
          obtained_at?: string
          quantity?: number
          rarity?: string
          slot?: string | null
          stat_effects?: Json
          tier?: string | null
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          description?: string
          effect?: string | null
          id?: string
          is_equipped?: boolean
          name?: string
          obtained_at?: string
          quantity?: number
          rarity?: string
          slot?: string | null
          stat_effects?: Json
          tier?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      journal_entries: {
        Row: {
          category: string
          content: string
          created_at: string
          dominant_emotion: string | null
          emotion_scores: Json | null
          emotion_tagged: boolean | null
          id: string
          importance: string
          mood: string | null
          tags: string[]
          title: string
          updated_at: string
          user_id: string
          xp_earned: number
        }
        Insert: {
          category?: string
          content?: string
          created_at?: string
          dominant_emotion?: string | null
          emotion_scores?: Json | null
          emotion_tagged?: boolean | null
          id?: string
          importance?: string
          mood?: string | null
          tags?: string[]
          title: string
          updated_at?: string
          user_id: string
          xp_earned?: number
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          dominant_emotion?: string | null
          emotion_scores?: Json | null
          emotion_tagged?: boolean | null
          id?: string
          importance?: string
          mood?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          user_id?: string
          xp_earned?: number
        }
        Relationships: []
      }
      mavis_action_queue: {
        Row: {
          action_payload: Json
          action_type: string
          agent_name: string | null
          approved_at: string | null
          autonomy_tier: string
          created_at: string
          draft_content: string | null
          executed_at: string | null
          expires_at: string
          id: string
          priority: number
          result_data: Json | null
          source_context: string | null
          source_system: string | null
          status: string
          telegram_message_id: string | null
          user_id: string
        }
        Insert: {
          action_payload?: Json
          action_type: string
          agent_name?: string | null
          approved_at?: string | null
          autonomy_tier?: string
          created_at?: string
          draft_content?: string | null
          executed_at?: string | null
          expires_at?: string
          id?: string
          priority?: number
          result_data?: Json | null
          source_context?: string | null
          source_system?: string | null
          status?: string
          telegram_message_id?: string | null
          user_id: string
        }
        Update: {
          action_payload?: Json
          action_type?: string
          agent_name?: string | null
          approved_at?: string | null
          autonomy_tier?: string
          created_at?: string
          draft_content?: string | null
          executed_at?: string | null
          expires_at?: string
          id?: string
          priority?: number
          result_data?: Json | null
          source_context?: string | null
          source_system?: string | null
          status?: string
          telegram_message_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_activities: {
        Row: {
          created_at: string
          description: string | null
          id: string
          payload: Json | null
          task_id: string | null
          type: string
          user_id: string
          xp_earned: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          payload?: Json | null
          task_id?: string | null
          type: string
          user_id: string
          xp_earned?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          payload?: Json | null
          task_id?: string | null
          type?: string
          user_id?: string
          xp_earned?: number
        }
        Relationships: []
      }
      mavis_agent_briefs: {
        Row: {
          actions_queued: number
          brief_type: string
          calendar_preview: string | null
          created_at: string
          id: string
          raw_data: Json | null
          summary: string | null
          urgent_items: Json
          user_id: string
        }
        Insert: {
          actions_queued?: number
          brief_type?: string
          calendar_preview?: string | null
          created_at?: string
          id?: string
          raw_data?: Json | null
          summary?: string | null
          urgent_items?: Json
          user_id: string
        }
        Update: {
          actions_queued?: number
          brief_type?: string
          calendar_preview?: string | null
          created_at?: string
          id?: string
          raw_data?: Json | null
          summary?: string | null
          urgent_items?: Json
          user_id?: string
        }
        Relationships: []
      }
      mavis_agent_karma: {
        Row: {
          agent_id: string
          id: string
          karma: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          agent_id: string
          id?: string
          karma?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          agent_id?: string
          id?: string
          karma?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mavis_agent_karma_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "councils"
            referencedColumns: ["id"]
          },
        ]
      }
      mavis_agent_memories: {
        Row: {
          access_count: number
          agent_id: string
          agent_name: string
          agent_type: string
          confidence: number | null
          content: string
          created_at: string | null
          ease_factor: number | null
          embedding: string | null
          entity_type: string
          fts: unknown
          id: string
          importance: number | null
          last_accessed_at: string | null
          memory_type: string
          next_review_at: string | null
          review_count: number | null
          source_date: string | null
          source_session: string | null
          status: string
          summary: string | null
          tags: string[] | null
          updated_at: string | null
          user_id: string
          wikilinks: string[] | null
        }
        Insert: {
          access_count?: number
          agent_id: string
          agent_name: string
          agent_type: string
          confidence?: number | null
          content: string
          created_at?: string | null
          ease_factor?: number | null
          embedding?: string | null
          entity_type: string
          fts?: unknown
          id?: string
          importance?: number | null
          last_accessed_at?: string | null
          memory_type: string
          next_review_at?: string | null
          review_count?: number | null
          source_date?: string | null
          source_session?: string | null
          status?: string
          summary?: string | null
          tags?: string[] | null
          updated_at?: string | null
          user_id: string
          wikilinks?: string[] | null
        }
        Update: {
          access_count?: number
          agent_id?: string
          agent_name?: string
          agent_type?: string
          confidence?: number | null
          content?: string
          created_at?: string | null
          ease_factor?: number | null
          embedding?: string | null
          entity_type?: string
          fts?: unknown
          id?: string
          importance?: number | null
          last_accessed_at?: string | null
          memory_type?: string
          next_review_at?: string | null
          review_count?: number | null
          source_date?: string | null
          source_session?: string | null
          status?: string
          summary?: string | null
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string
          wikilinks?: string[] | null
        }
        Relationships: []
      }
      mavis_agent_schedules: {
        Row: {
          agent_name: string
          config: Json
          created_at: string
          cron_expr: string
          enabled: boolean
          id: string
          last_run_at: string | null
          next_run_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_name: string
          config?: Json
          created_at?: string
          cron_expr?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          next_run_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_name?: string
          config?: Json
          created_at?: string
          cron_expr?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          next_run_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_agent_traces: {
        Row: {
          action_type: string | null
          created_at: string | null
          duration_ms: number | null
          id: string
          iteration: number | null
          ok: boolean | null
          params: Json | null
          result: Json | null
          session_id: string | null
          turn: number | null
          user_id: string
        }
        Insert: {
          action_type?: string | null
          created_at?: string | null
          duration_ms?: number | null
          id?: string
          iteration?: number | null
          ok?: boolean | null
          params?: Json | null
          result?: Json | null
          session_id?: string | null
          turn?: number | null
          user_id: string
        }
        Update: {
          action_type?: string | null
          created_at?: string | null
          duration_ms?: number | null
          id?: string
          iteration?: number | null
          ok?: boolean | null
          params?: Json | null
          result?: Json | null
          session_id?: string | null
          turn?: number | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_autonomous_runs: {
        Row: {
          id: number
          job_name: string
          notes: string | null
          response_code: number | null
          status: string | null
          triggered_at: string | null
        }
        Insert: {
          id?: number
          job_name: string
          notes?: string | null
          response_code?: number | null
          status?: string | null
          triggered_at?: string | null
        }
        Update: {
          id?: number
          job_name?: string
          notes?: string | null
          response_code?: number | null
          status?: string | null
          triggered_at?: string | null
        }
        Relationships: []
      }
      mavis_autonomy_config: {
        Row: {
          action_type: string
          created_at: string
          id: string
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_type: string
          created_at?: string
          id?: string
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          id?: string
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_autonomy_settings: {
        Row: {
          action_type: string
          approval_count: number
          id: string
          last_action_at: string
          rejection_count: number
          tier: string
          user_id: string
        }
        Insert: {
          action_type: string
          approval_count?: number
          id?: string
          last_action_at?: string
          rejection_count?: number
          tier?: string
          user_id: string
        }
        Update: {
          action_type?: string
          approval_count?: number
          id?: string
          last_action_at?: string
          rejection_count?: number
          tier?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_behavioral_signals: {
        Row: {
          action_type: string | null
          created_at: string | null
          day_of_week: number | null
          hour_of_day: number | null
          id: string
          metadata: Json | null
          outcome: string | null
          signal_type: string
          tool_name: string | null
          user_id: string
        }
        Insert: {
          action_type?: string | null
          created_at?: string | null
          day_of_week?: number | null
          hour_of_day?: number | null
          id?: string
          metadata?: Json | null
          outcome?: string | null
          signal_type: string
          tool_name?: string | null
          user_id: string
        }
        Update: {
          action_type?: string | null
          created_at?: string | null
          day_of_week?: number | null
          hour_of_day?: number | null
          id?: string
          metadata?: Json | null
          outcome?: string | null
          signal_type?: string
          tool_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_bond: {
        Row: {
          bond_level: number | null
          created_at: string | null
          id: string
          interaction_count: number | null
          last_interaction_at: string | null
          milestones: Json | null
          trust_level: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          bond_level?: number | null
          created_at?: string | null
          id?: string
          interaction_count?: number | null
          last_interaction_at?: string | null
          milestones?: Json | null
          trust_level?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          bond_level?: number | null
          created_at?: string | null
          id?: string
          interaction_count?: number | null
          last_interaction_at?: string | null
          milestones?: Json | null
          trust_level?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_bookings: {
        Row: {
          attendees: Json | null
          booking_type: string
          created_at: string | null
          description: string | null
          end_time: string | null
          external_id: string | null
          id: string
          location: string | null
          metadata: Json | null
          provider: string | null
          start_time: string
          status: string | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          attendees?: Json | null
          booking_type: string
          created_at?: string | null
          description?: string | null
          end_time?: string | null
          external_id?: string | null
          id?: string
          location?: string | null
          metadata?: Json | null
          provider?: string | null
          start_time: string
          status?: string | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          attendees?: Json | null
          booking_type?: string
          created_at?: string | null
          description?: string | null
          end_time?: string | null
          external_id?: string | null
          id?: string
          location?: string | null
          metadata?: Json | null
          provider?: string | null
          start_time?: string
          status?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_calls: {
        Row: {
          cost_cents: number | null
          created_at: string | null
          direction: string
          duration_seconds: number | null
          ended_at: string | null
          from_number: string | null
          id: string
          metadata: Json | null
          outcome: string | null
          purpose: string
          recording_url: string | null
          status: string
          summary: string | null
          to_number: string | null
          transcript: Json | null
          updated_at: string | null
          user_id: string
          vapi_call_id: string | null
        }
        Insert: {
          cost_cents?: number | null
          created_at?: string | null
          direction?: string
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          metadata?: Json | null
          outcome?: string | null
          purpose: string
          recording_url?: string | null
          status?: string
          summary?: string | null
          to_number?: string | null
          transcript?: Json | null
          updated_at?: string | null
          user_id: string
          vapi_call_id?: string | null
        }
        Update: {
          cost_cents?: number | null
          created_at?: string | null
          direction?: string
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          metadata?: Json | null
          outcome?: string | null
          purpose?: string
          recording_url?: string | null
          status?: string
          summary?: string | null
          to_number?: string | null
          transcript?: Json | null
          updated_at?: string | null
          user_id?: string
          vapi_call_id?: string | null
        }
        Relationships: []
      }
      mavis_campaigns: {
        Row: {
          created_at: string
          current_step: number
          description: string | null
          id: string
          status: string
          steps: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_step?: number
          description?: string | null
          id?: string
          status?: string
          steps?: Json
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_step?: number
          description?: string | null
          id?: string
          status?: string
          steps?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_capabilities: {
        Row: {
          action_type: string
          category: string
          created_at: string | null
          description: string
          edge_function: string | null
          example_params: Json | null
          id: string
          is_active: boolean | null
          requires_secrets: string[] | null
        }
        Insert: {
          action_type: string
          category: string
          created_at?: string | null
          description: string
          edge_function?: string | null
          example_params?: Json | null
          id?: string
          is_active?: boolean | null
          requires_secrets?: string[] | null
        }
        Update: {
          action_type?: string
          category?: string
          created_at?: string | null
          description?: string
          edge_function?: string | null
          example_params?: Json | null
          id?: string
          is_active?: boolean | null
          requires_secrets?: string[] | null
        }
        Relationships: []
      }
      mavis_causal_chains: {
        Row: {
          action_implication: string | null
          cause: string
          confidence: number
          correlation: number
          created_at: string
          description: string
          effect: string
          id: string
          lag_days: number
          sample_size: number
          user_id: string
          week_of: string
        }
        Insert: {
          action_implication?: string | null
          cause: string
          confidence: number
          correlation: number
          created_at?: string
          description: string
          effect: string
          id?: string
          lag_days?: number
          sample_size?: number
          user_id: string
          week_of?: string
        }
        Update: {
          action_implication?: string | null
          cause?: string
          confidence?: number
          correlation?: number
          created_at?: string
          description?: string
          effect?: string
          id?: string
          lag_days?: number
          sample_size?: number
          user_id?: string
          week_of?: string
        }
        Relationships: []
      }
      mavis_consolidation_log: {
        Row: {
          created_at: string | null
          id: string
          knowledge_entries_created: number | null
          messages_processed: number | null
          session_date: string
          summary: string | null
          tacit_entries_created: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          knowledge_entries_created?: number | null
          messages_processed?: number | null
          session_date: string
          summary?: string | null
          tacit_entries_created?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          knowledge_entries_created?: number | null
          messages_processed?: number | null
          session_date?: string
          summary?: string | null
          tacit_entries_created?: number | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_council_memory: {
        Row: {
          content: string
          council_member_id: string
          created_at: string | null
          embedding: string | null
          id: string
          tags: string[] | null
          user_id: string
        }
        Insert: {
          content: string
          council_member_id: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          tags?: string[] | null
          user_id: string
        }
        Update: {
          content?: string
          council_member_id?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          tags?: string[] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mavis_council_memory_council_member_id_fkey"
            columns: ["council_member_id"]
            isOneToOne: false
            referencedRelation: "councils"
            referencedColumns: ["id"]
          },
        ]
      }
      mavis_council_messages: {
        Row: {
          content: string
          created_at: string | null
          from_member_id: string | null
          from_member_name: string | null
          id: string
          read: boolean | null
          to_member_id: string
          to_member_name: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          from_member_id?: string | null
          from_member_name?: string | null
          id?: string
          read?: boolean | null
          to_member_id: string
          to_member_name?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          from_member_id?: string | null
          from_member_name?: string | null
          id?: string
          read?: boolean | null
          to_member_id?: string
          to_member_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mavis_council_messages_from_member_id_fkey"
            columns: ["from_member_id"]
            isOneToOne: false
            referencedRelation: "councils"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mavis_council_messages_to_member_id_fkey"
            columns: ["to_member_id"]
            isOneToOne: false
            referencedRelation: "councils"
            referencedColumns: ["id"]
          },
        ]
      }
      mavis_cron_config: {
        Row: {
          created_at: string | null
          edge_function: string
          enabled: boolean | null
          id: number
          job_name: string
          payload: Json | null
          schedule: string
        }
        Insert: {
          created_at?: string | null
          edge_function: string
          enabled?: boolean | null
          id?: number
          job_name: string
          payload?: Json | null
          schedule: string
        }
        Update: {
          created_at?: string | null
          edge_function?: string
          enabled?: boolean | null
          id?: number
          job_name?: string
          payload?: Json | null
          schedule?: string
        }
        Relationships: []
      }
      mavis_custom_skills: {
        Row: {
          created_at: string | null
          description: string
          enabled: boolean | null
          id: string
          modes: string[] | null
          name: string
          system_prompt: string
          tools: string[] | null
          trigger_phrase: string | null
          updated_at: string | null
          user_id: string
          version: number | null
        }
        Insert: {
          created_at?: string | null
          description: string
          enabled?: boolean | null
          id?: string
          modes?: string[] | null
          name: string
          system_prompt: string
          tools?: string[] | null
          trigger_phrase?: string | null
          updated_at?: string | null
          user_id: string
          version?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string
          enabled?: boolean | null
          id?: string
          modes?: string[] | null
          name?: string
          system_prompt?: string
          tools?: string[] | null
          trigger_phrase?: string | null
          updated_at?: string | null
          user_id?: string
          version?: number | null
        }
        Relationships: []
      }
      mavis_daily_briefs: {
        Row: {
          brief_date: string
          brief_text: string
          created_at: string
          id: string
          sections: Json
          user_id: string
        }
        Insert: {
          brief_date: string
          brief_text: string
          created_at?: string
          id?: string
          sections?: Json
          user_id: string
        }
        Update: {
          brief_date?: string
          brief_text?: string
          created_at?: string
          id?: string
          sections?: Json
          user_id?: string
        }
        Relationships: []
      }
      mavis_daily_scores: {
        Row: {
          components: Json
          created_at: string
          id: string
          optimal_window: string | null
          raw_data: Json
          recommendation: string | null
          score: number
          score_date: string
          trend: string | null
          user_id: string
        }
        Insert: {
          components?: Json
          created_at?: string
          id?: string
          optimal_window?: string | null
          raw_data?: Json
          recommendation?: string | null
          score: number
          score_date: string
          trend?: string | null
          user_id: string
        }
        Update: {
          components?: Json
          created_at?: string
          id?: string
          optimal_window?: string | null
          raw_data?: Json
          recommendation?: string | null
          score?: number
          score_date?: string
          trend?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_design_components: {
        Row: {
          accessibility_score: number | null
          component_name: string
          component_type: string
          created_at: string | null
          css_code: string | null
          design_tokens: Json | null
          id: string
          is_reusable: boolean | null
          performance_notes: string | null
          project_id: string | null
          props_interface: string | null
          storybook_story: string | null
          tags: string[] | null
          times_used: number | null
          tsx_code: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          accessibility_score?: number | null
          component_name: string
          component_type: string
          created_at?: string | null
          css_code?: string | null
          design_tokens?: Json | null
          id?: string
          is_reusable?: boolean | null
          performance_notes?: string | null
          project_id?: string | null
          props_interface?: string | null
          storybook_story?: string | null
          tags?: string[] | null
          times_used?: number | null
          tsx_code?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          accessibility_score?: number | null
          component_name?: string
          component_type?: string
          created_at?: string | null
          css_code?: string | null
          design_tokens?: Json | null
          id?: string
          is_reusable?: boolean | null
          performance_notes?: string | null
          project_id?: string | null
          props_interface?: string | null
          storybook_story?: string | null
          tags?: string[] | null
          times_used?: number | null
          tsx_code?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mavis_design_components_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "mavis_design_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mavis_design_projects: {
        Row: {
          aesthetic_directives: string | null
          brand: string
          client_name: string | null
          competitor_urls: string[] | null
          created_at: string | null
          deadline_tier: string | null
          design_system: Json | null
          generated_files: Json | null
          id: string
          key_features: string[] | null
          project_goal: string
          project_name: string
          project_value: number | null
          quality_gate_results: Json | null
          status: string | null
          strategic_blueprint: Json | null
          target_audience: string
          updated_at: string | null
          user_id: string
          user_journey: string | null
        }
        Insert: {
          aesthetic_directives?: string | null
          brand?: string
          client_name?: string | null
          competitor_urls?: string[] | null
          created_at?: string | null
          deadline_tier?: string | null
          design_system?: Json | null
          generated_files?: Json | null
          id?: string
          key_features?: string[] | null
          project_goal: string
          project_name: string
          project_value?: number | null
          quality_gate_results?: Json | null
          status?: string | null
          strategic_blueprint?: Json | null
          target_audience: string
          updated_at?: string | null
          user_id: string
          user_journey?: string | null
        }
        Update: {
          aesthetic_directives?: string | null
          brand?: string
          client_name?: string | null
          competitor_urls?: string[] | null
          created_at?: string | null
          deadline_tier?: string | null
          design_system?: Json | null
          generated_files?: Json | null
          id?: string
          key_features?: string[] | null
          project_goal?: string
          project_name?: string
          project_value?: number | null
          quality_gate_results?: Json | null
          status?: string | null
          strategic_blueprint?: Json | null
          target_audience?: string
          updated_at?: string | null
          user_id?: string
          user_journey?: string | null
        }
        Relationships: []
      }
      mavis_design_tokens: {
        Row: {
          brand: string
          created_at: string | null
          id: string
          is_default: boolean | null
          token_set: Json
          user_id: string
        }
        Insert: {
          brand?: string
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          token_set: Json
          user_id: string
        }
        Update: {
          brand?: string
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          token_set?: Json
          user_id?: string
        }
        Relationships: []
      }
      mavis_documents: {
        Row: {
          content: string | null
          created_at: string | null
          embedding: string | null
          id: number
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: number
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: number
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      mavis_domain_effects: {
        Row: {
          area_effects: string[]
          created_at: string
          description: string | null
          effect_type: string
          expires_at: string | null
          id: string
          is_active: boolean
          name: string
          source: string | null
          stat_modifiers: Json
          user_id: string
        }
        Insert: {
          area_effects?: string[]
          created_at?: string
          description?: string | null
          effect_type?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          source?: string | null
          stat_modifiers?: Json
          user_id: string
        }
        Update: {
          area_effects?: string[]
          created_at?: string
          description?: string | null
          effect_type?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          source?: string | null
          stat_modifiers?: Json
          user_id?: string
        }
        Relationships: []
      }
      mavis_email_watches: {
        Row: {
          active: boolean | null
          contact_email: string
          contact_name: string | null
          context: string | null
          created_at: string | null
          id: string
          triggered_at: string | null
          user_id: string
        }
        Insert: {
          active?: boolean | null
          contact_email: string
          contact_name?: string | null
          context?: string | null
          created_at?: string | null
          id?: string
          triggered_at?: string | null
          user_id: string
        }
        Update: {
          active?: boolean | null
          contact_email?: string
          contact_name?: string | null
          context?: string | null
          created_at?: string | null
          id?: string
          triggered_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_evolution_log: {
        Row: {
          affected_key: string | null
          created_at: string
          evidence: string | null
          evolution_type: string
          id: string
          new_confidence: number | null
          new_value: string | null
          old_confidence: number | null
          old_value: string | null
          reason: string
          user_id: string
        }
        Insert: {
          affected_key?: string | null
          created_at?: string
          evidence?: string | null
          evolution_type: string
          id?: string
          new_confidence?: number | null
          new_value?: string | null
          old_confidence?: number | null
          old_value?: string | null
          reason: string
          user_id: string
        }
        Update: {
          affected_key?: string | null
          created_at?: string
          evidence?: string | null
          evolution_type?: string
          id?: string
          new_confidence?: number | null
          new_value?: string | null
          old_confidence?: number | null
          old_value?: string | null
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_expenses: {
        Row: {
          amount: number
          category: string | null
          created_at: string | null
          currency: string | null
          description: string
          expense_date: string | null
          id: string
          source: string | null
          user_id: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string | null
          currency?: string | null
          description: string
          expense_date?: string | null
          id?: string
          source?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string
          expense_date?: string | null
          id?: string
          source?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_function_health: {
        Row: {
          error_count: number | null
          expected_interval_min: number
          function_name: string
          last_completed_at: string | null
          last_error: string | null
          last_started_at: string | null
          last_status: string | null
          run_count: number | null
          updated_at: string | null
        }
        Insert: {
          error_count?: number | null
          expected_interval_min?: number
          function_name: string
          last_completed_at?: string | null
          last_error?: string | null
          last_started_at?: string | null
          last_status?: string | null
          run_count?: number | null
          updated_at?: string | null
        }
        Update: {
          error_count?: number | null
          expected_interval_min?: number
          function_name?: string
          last_completed_at?: string | null
          last_error?: string | null
          last_started_at?: string | null
          last_status?: string | null
          run_count?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      mavis_goal_judge_log: {
        Row: {
          ai_response: string | null
          continuation_prompt: string | null
          created_at: string | null
          goal_id: string | null
          goal_objective: string | null
          id: string
          judge_reason: string | null
          judge_verdict: boolean | null
          max_turns: number | null
          turn_number: number | null
          user_id: string
        }
        Insert: {
          ai_response?: string | null
          continuation_prompt?: string | null
          created_at?: string | null
          goal_id?: string | null
          goal_objective?: string | null
          id?: string
          judge_reason?: string | null
          judge_verdict?: boolean | null
          max_turns?: number | null
          turn_number?: number | null
          user_id: string
        }
        Update: {
          ai_response?: string | null
          continuation_prompt?: string | null
          created_at?: string | null
          goal_id?: string | null
          goal_objective?: string | null
          id?: string
          judge_reason?: string | null
          judge_verdict?: boolean | null
          max_turns?: number | null
          turn_number?: number | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_goals: {
        Row: {
          context: string | null
          created_at: string | null
          decomposed: boolean | null
          id: string
          objective: string
          quest_ids: string[] | null
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          context?: string | null
          created_at?: string | null
          decomposed?: boolean | null
          id?: string
          objective: string
          quest_ids?: string[] | null
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          context?: string | null
          created_at?: string | null
          decomposed?: boolean | null
          id?: string
          objective?: string
          quest_ids?: string[] | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_knowledge: {
        Row: {
          category: string
          content: string
          created_at: string | null
          id: string
          last_referenced: string | null
          related_ids: string[] | null
          tags: string[] | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          category: string
          content: string
          created_at?: string | null
          id?: string
          last_referenced?: string | null
          related_ids?: string[] | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          category?: string
          content?: string
          created_at?: string | null
          id?: string
          last_referenced?: string | null
          related_ids?: string[] | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_learned_preferences: {
        Row: {
          confidence: number | null
          key: string
          preference_type: string
          sample_size: number | null
          updated_at: string | null
          user_id: string
          value: Json
        }
        Insert: {
          confidence?: number | null
          key: string
          preference_type: string
          sample_size?: number | null
          updated_at?: string | null
          user_id: string
          value: Json
        }
        Update: {
          confidence?: number | null
          key?: string
          preference_type?: string
          sample_size?: number | null
          updated_at?: string | null
          user_id?: string
          value?: Json
        }
        Relationships: []
      }
      mavis_letta_agents: {
        Row: {
          created_at: string | null
          id: string
          last_messaged_at: string | null
          letta_agent_id: string
          persona_name: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_messaged_at?: string | null
          letta_agent_id: string
          persona_name?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          last_messaged_at?: string | null
          letta_agent_id?: string
          persona_name?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_llm_calls: {
        Row: {
          completion_tokens: number | null
          created_at: string | null
          duration_ms: number | null
          error_msg: string | null
          estimated_cost_usd: number | null
          id: string
          mode: string | null
          model: string | null
          prompt_tokens: number | null
          provider: string
          success: boolean | null
          total_tokens: number | null
          user_id: string
        }
        Insert: {
          completion_tokens?: number | null
          created_at?: string | null
          duration_ms?: number | null
          error_msg?: string | null
          estimated_cost_usd?: number | null
          id?: string
          mode?: string | null
          model?: string | null
          prompt_tokens?: number | null
          provider: string
          success?: boolean | null
          total_tokens?: number | null
          user_id: string
        }
        Update: {
          completion_tokens?: number | null
          created_at?: string | null
          duration_ms?: number | null
          error_msg?: string | null
          estimated_cost_usd?: number | null
          id?: string
          mode?: string | null
          model?: string | null
          prompt_tokens?: number | null
          provider?: string
          success?: boolean | null
          total_tokens?: number | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_market_intel: {
        Row: {
          created_at: string
          headline: string
          id: string
          notified: boolean
          relevance_score: number
          signal_type: string
          source_date: string
          summary: string
          topic: string
          url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          headline: string
          id?: string
          notified?: boolean
          relevance_score: number
          signal_type?: string
          source_date?: string
          summary: string
          topic: string
          url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          headline?: string
          id?: string
          notified?: boolean
          relevance_score?: number
          signal_type?: string
          source_date?: string
          summary?: string
          topic?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_media_library: {
        Row: {
          analysis: Json | null
          blueprint: Json | null
          created_at: string
          duration_seconds: number | null
          error_message: string | null
          file_size_bytes: number | null
          file_url: string | null
          gemini_file_uri: string | null
          height: number | null
          id: string
          media_type: string
          mime_type: string | null
          source_tool: string | null
          status: string
          storage_path: string
          title: string | null
          updated_at: string
          user_id: string
          width: number | null
        }
        Insert: {
          analysis?: Json | null
          blueprint?: Json | null
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          gemini_file_uri?: string | null
          height?: number | null
          id?: string
          media_type: string
          mime_type?: string | null
          source_tool?: string | null
          status?: string
          storage_path: string
          title?: string | null
          updated_at?: string
          user_id: string
          width?: number | null
        }
        Update: {
          analysis?: Json | null
          blueprint?: Json | null
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          gemini_file_uri?: string | null
          height?: number | null
          id?: string
          media_type?: string
          mime_type?: string | null
          source_tool?: string | null
          status?: string
          storage_path?: string
          title?: string | null
          updated_at?: string
          user_id?: string
          width?: number | null
        }
        Relationships: []
      }
      mavis_meeting_preps: {
        Row: {
          attendees: string[]
          context_notes: string | null
          created_at: string
          event_id: string
          event_start: string
          event_title: string
          id: string
          prep_brief: string
          prep_sent: boolean
          talking_points: string[]
          user_id: string
        }
        Insert: {
          attendees?: string[]
          context_notes?: string | null
          created_at?: string
          event_id: string
          event_start: string
          event_title: string
          id?: string
          prep_brief: string
          prep_sent?: boolean
          talking_points?: string[]
          user_id: string
        }
        Update: {
          attendees?: string[]
          context_notes?: string | null
          created_at?: string
          event_id?: string
          event_start?: string
          event_title?: string
          id?: string
          prep_brief?: string
          prep_sent?: boolean
          talking_points?: string[]
          user_id?: string
        }
        Relationships: []
      }
      mavis_mem0_sync_log: {
        Row: {
          conversation_id: string | null
          id: string
          memory_count: number | null
          synced_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          id?: string
          memory_count?: number | null
          synced_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          id?: string
          memory_count?: number | null
          synced_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_memory: {
        Row: {
          consolidated: boolean | null
          content: string
          created_at: string | null
          embedding: string | null
          id: string
          importance_score: number | null
          role: string
          session_id: string
          timestamp: number
          user_id: string
        }
        Insert: {
          consolidated?: boolean | null
          content: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          importance_score?: number | null
          role: string
          session_id: string
          timestamp: number
          user_id: string
        }
        Update: {
          consolidated?: boolean | null
          content?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          importance_score?: number | null
          role?: string
          session_id?: string
          timestamp?: number
          user_id?: string
        }
        Relationships: []
      }
      mavis_memory_embed_queue: {
        Row: {
          created_at: string | null
          id: number
          memory_id: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          memory_id: number
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: number
          memory_id?: number
          user_id?: string
        }
        Relationships: []
      }
      mavis_note_links: {
        Row: {
          created_at: string
          description: string | null
          id: string
          source_note_id: string
          target_note_id: string
          type: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          source_note_id: string
          target_note_id: string
          type?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          source_note_id?: string
          target_note_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "mavis_note_links_source_note_id_fkey"
            columns: ["source_note_id"]
            isOneToOne: false
            referencedRelation: "mavis_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mavis_note_links_target_note_id_fkey"
            columns: ["target_note_id"]
            isOneToOne: false
            referencedRelation: "mavis_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      mavis_note_versions: {
        Row: {
          content: string
          created_at: string
          id: string
          note_id: string
          title: string
          version_number: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          note_id: string
          title: string
          version_number: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          note_id?: string
          title?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "mavis_note_versions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "mavis_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      mavis_notes: {
        Row: {
          access_count: number
          aliases: string[]
          content: string
          created_at: string
          embedding: string | null
          fts: unknown
          id: string
          last_accessed_at: string | null
          last_reviewed_at: string | null
          next_review_at: string | null
          properties: Json
          review_interval_days: number | null
          source_url: string | null
          tags: string[]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_count?: number
          aliases?: string[]
          content?: string
          created_at?: string
          embedding?: string | null
          fts?: unknown
          id?: string
          last_accessed_at?: string | null
          last_reviewed_at?: string | null
          next_review_at?: string | null
          properties?: Json
          review_interval_days?: number | null
          source_url?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_count?: number
          aliases?: string[]
          content?: string
          created_at?: string
          embedding?: string | null
          fts?: unknown
          id?: string
          last_accessed_at?: string | null
          last_reviewed_at?: string | null
          next_review_at?: string | null
          properties?: Json
          review_interval_days?: number | null
          source_url?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_oauth_tokens: {
        Row: {
          access_token: string
          created_at: string | null
          expires_at: number | null
          id: string
          instance_url: string | null
          metadata: Json | null
          provider: string
          refresh_token: string | null
          scope: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string | null
          expires_at?: number | null
          id?: string
          instance_url?: string | null
          metadata?: Json | null
          provider: string
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string | null
          expires_at?: number | null
          id?: string
          instance_url?: string | null
          metadata?: Json | null
          provider?: string
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_outcome_events: {
        Row: {
          actual_outcome: string | null
          checked_at: string | null
          confidence_score: number | null
          created_at: string
          due_check_at: string
          evidence_data: Json | null
          id: string
          outcome_status: string
          predicted_outcome: string | null
          prediction_text: string
          source_id: string | null
          source_type: string
          user_id: string
        }
        Insert: {
          actual_outcome?: string | null
          checked_at?: string | null
          confidence_score?: number | null
          created_at?: string
          due_check_at?: string
          evidence_data?: Json | null
          id?: string
          outcome_status?: string
          predicted_outcome?: string | null
          prediction_text: string
          source_id?: string | null
          source_type: string
          user_id: string
        }
        Update: {
          actual_outcome?: string | null
          checked_at?: string | null
          confidence_score?: number | null
          created_at?: string
          due_check_at?: string
          evidence_data?: Json | null
          id?: string
          outcome_status?: string
          predicted_outcome?: string | null
          prediction_text?: string
          source_id?: string | null
          source_type?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_outreach_drafts: {
        Row: {
          contact_name: string
          created_at: string
          drafted_message: string
          id: string
          status: string
          user_id: string
        }
        Insert: {
          contact_name: string
          created_at?: string
          drafted_message: string
          id?: string
          status?: string
          user_id: string
        }
        Update: {
          contact_name?: string
          created_at?: string
          drafted_message?: string
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_persona_memory: {
        Row: {
          category: string
          consolidated: boolean
          content: string
          created_at: string
          embedding: string | null
          id: string
          importance: number
          key: string | null
          persona_id: string | null
          persona_name: string
          role: string
          session_id: string | null
          source: string | null
          user_id: string
          value: string | null
        }
        Insert: {
          category?: string
          consolidated?: boolean
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          importance?: number
          key?: string | null
          persona_id?: string | null
          persona_name: string
          role: string
          session_id?: string | null
          source?: string | null
          user_id: string
          value?: string | null
        }
        Update: {
          category?: string
          consolidated?: boolean
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          importance?: number
          key?: string | null
          persona_id?: string | null
          persona_name?: string
          role?: string
          session_id?: string | null
          source?: string | null
          user_id?: string
          value?: string | null
        }
        Relationships: []
      }
      mavis_plan_steps: {
        Row: {
          actions: Json | null
          completed_at: string | null
          created_at: string | null
          depends_on: string[] | null
          description: string | null
          error: string | null
          estimated_minutes: number | null
          id: string
          phase: string | null
          plan_id: string
          quest_id: string | null
          result: string | null
          started_at: string | null
          status: string
          step_index: number
          step_order: number | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          actions?: Json | null
          completed_at?: string | null
          created_at?: string | null
          depends_on?: string[] | null
          description?: string | null
          error?: string | null
          estimated_minutes?: number | null
          id?: string
          phase?: string | null
          plan_id: string
          quest_id?: string | null
          result?: string | null
          started_at?: string | null
          status?: string
          step_index: number
          step_order?: number | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          actions?: Json | null
          completed_at?: string | null
          created_at?: string | null
          depends_on?: string[] | null
          description?: string | null
          error?: string | null
          estimated_minutes?: number | null
          id?: string
          phase?: string | null
          plan_id?: string
          quest_id?: string | null
          result?: string | null
          started_at?: string | null
          status?: string
          step_index?: number
          step_order?: number | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mavis_plan_steps_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "mavis_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      mavis_plans: {
        Row: {
          context: Json | null
          created_at: string | null
          done_steps: number
          goal: string
          id: string
          status: string
          summary: string | null
          title: string
          total_steps: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          context?: Json | null
          created_at?: string | null
          done_steps?: number
          goal: string
          id?: string
          status?: string
          summary?: string | null
          title: string
          total_steps?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          context?: Json | null
          created_at?: string | null
          done_steps?: number
          goal?: string
          id?: string
          status?: string
          summary?: string | null
          title?: string
          total_steps?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_playbooks: {
        Row: {
          created_at: string | null
          description: string | null
          domain: string
          id: string
          is_active: boolean | null
          is_system: boolean | null
          name: string
          procedures: Json | null
          slug: string
          tags: string[] | null
          updated_at: string | null
          usage_count: number | null
          user_id: string | null
          version: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          domain: string
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name: string
          procedures?: Json | null
          slug: string
          tags?: string[] | null
          updated_at?: string | null
          usage_count?: number | null
          user_id?: string | null
          version?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          domain?: string
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name?: string
          procedures?: Json | null
          slug?: string
          tags?: string[] | null
          updated_at?: string | null
          usage_count?: number | null
          user_id?: string | null
          version?: number | null
        }
        Relationships: []
      }
      mavis_products: {
        Row: {
          audience: string | null
          category: string | null
          content: string
          created_at: string | null
          description: string | null
          gumroad_product_id: string | null
          gumroad_url: string | null
          id: string
          payment_link: string | null
          pdf_url: string | null
          platform: string | null
          price_cents: number
          revenue_total: number
          sales_count: number
          status: string
          stripe_price_id: string | null
          stripe_product_id: string | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          audience?: string | null
          category?: string | null
          content: string
          created_at?: string | null
          description?: string | null
          gumroad_product_id?: string | null
          gumroad_url?: string | null
          id?: string
          payment_link?: string | null
          pdf_url?: string | null
          platform?: string | null
          price_cents?: number
          revenue_total?: number
          sales_count?: number
          status?: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          audience?: string | null
          category?: string | null
          content?: string
          created_at?: string | null
          description?: string | null
          gumroad_product_id?: string | null
          gumroad_url?: string | null
          id?: string
          payment_link?: string | null
          pdf_url?: string | null
          platform?: string | null
          price_cents?: number
          revenue_total?: number
          sales_count?: number
          status?: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_response_feedback: {
        Row: {
          conversation_id: string | null
          created_at: string | null
          id: string
          message_id: string
          mode: string | null
          provider: string | null
          rating: number
          response_preview: string | null
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          message_id: string
          mode?: string | null
          provider?: string | null
          rating: number
          response_preview?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          message_id?: string
          mode?: string | null
          provider?: string | null
          rating?: number
          response_preview?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_revenue: {
        Row: {
          amount: number
          created_at: string | null
          currency: string | null
          description: string | null
          gumroad_sale_id: string | null
          id: string
          source: string
          stripe_payment_id: string | null
          task_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string | null
          description?: string | null
          gumroad_sale_id?: string | null
          id?: string
          source: string
          stripe_payment_id?: string | null
          task_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string | null
          description?: string | null
          gumroad_sale_id?: string | null
          id?: string
          source?: string
          stripe_payment_id?: string | null
          task_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mavis_revenue_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "mavis_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      mavis_rss_feeds: {
        Row: {
          created_at: string | null
          enabled: boolean
          feed_url: string
          id: string
          last_error: string | null
          last_fetched_at: string | null
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean
          feed_url: string
          id?: string
          last_error?: string | null
          last_fetched_at?: string | null
          name?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          enabled?: boolean
          feed_url?: string
          id?: string
          last_error?: string | null
          last_fetched_at?: string | null
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_scrape_queue: {
        Row: {
          created_at: string | null
          domain: string
          emails: string[] | null
          id: number
          link: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          domain: string
          emails?: string[] | null
          id?: number
          link: string
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          domain?: string
          emails?: string[] | null
          id?: number
          link?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_skill_definitions: {
        Row: {
          created_at: string | null
          description: string
          id: string
          invocation_count: number
          is_active: boolean
          keywords: string[]
          name: string
          prompt_template: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description: string
          id?: string
          invocation_count?: number
          is_active?: boolean
          keywords?: string[]
          name: string
          prompt_template: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string
          id?: string
          invocation_count?: number
          is_active?: boolean
          keywords?: string[]
          name?: string
          prompt_template?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_so_executions: {
        Row: {
          completed_at: string | null
          error_message: string | null
          id: string
          metadata: Json | null
          result: string | null
          started_at: string | null
          status: string | null
          template_id: string | null
          template_slug: string | null
          triggered_by: string | null
          turns_used: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          result?: string | null
          started_at?: string | null
          status?: string | null
          template_id?: string | null
          template_slug?: string | null
          triggered_by?: string | null
          turns_used?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          result?: string | null
          started_at?: string | null
          status?: string | null
          template_id?: string | null
          template_slug?: string | null
          triggered_by?: string | null
          turns_used?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mavis_so_executions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "standing_order_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      mavis_social_personas: {
        Row: {
          active: boolean | null
          bio: string | null
          created_at: string | null
          display_name: string
          id: string
          metadata: Json | null
          persona_name: string
          platforms: Json | null
          post_formats: Json | null
          tone: string | null
          topics: string[] | null
          updated_at: string | null
          user_id: string
          voice: string
        }
        Insert: {
          active?: boolean | null
          bio?: string | null
          created_at?: string | null
          display_name: string
          id?: string
          metadata?: Json | null
          persona_name: string
          platforms?: Json | null
          post_formats?: Json | null
          tone?: string | null
          topics?: string[] | null
          updated_at?: string | null
          user_id: string
          voice?: string
        }
        Update: {
          active?: boolean | null
          bio?: string | null
          created_at?: string | null
          display_name?: string
          id?: string
          metadata?: Json | null
          persona_name?: string
          platforms?: Json | null
          post_formats?: Json | null
          tone?: string | null
          topics?: string[] | null
          updated_at?: string | null
          user_id?: string
          voice?: string
        }
        Relationships: []
      }
      mavis_social_posts: {
        Row: {
          content: string
          created_at: string | null
          engagement: Json | null
          error: string | null
          external_id: string | null
          id: string
          media_urls: string[] | null
          metadata: Json | null
          persona: string
          persona_id: string | null
          platform: string
          posted_at: string | null
          scheduled_at: string | null
          status: string
          thread_parent_id: string | null
          tweet_id: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          engagement?: Json | null
          error?: string | null
          external_id?: string | null
          id?: string
          media_urls?: string[] | null
          metadata?: Json | null
          persona?: string
          persona_id?: string | null
          platform?: string
          posted_at?: string | null
          scheduled_at?: string | null
          status?: string
          thread_parent_id?: string | null
          tweet_id?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          engagement?: Json | null
          error?: string | null
          external_id?: string | null
          id?: string
          media_urls?: string[] | null
          metadata?: Json | null
          persona?: string
          persona_id?: string | null
          platform?: string
          posted_at?: string | null
          scheduled_at?: string | null
          status?: string
          thread_parent_id?: string | null
          tweet_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mavis_social_posts_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "mavis_social_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      mavis_social_queue: {
        Row: {
          article_text: string | null
          article_title: string | null
          created_at: string | null
          error_message: string | null
          extraction_status: string
          facebook_content: string | null
          generated_image_url: string | null
          heygen_video_id: string | null
          id: string
          image_status: string
          instagram_content: string | null
          linkedin_content: string | null
          notes: string | null
          publish_results: Json | null
          published_at: string | null
          scheduled_date: string | null
          source_url: string | null
          status: string
          threads_content: string | null
          tiktok_content: string | null
          twitter_content: string | null
          updated_at: string | null
          user_id: string
          video_caption: string | null
          video_script: string | null
          video_status: string
          video_url: string | null
        }
        Insert: {
          article_text?: string | null
          article_title?: string | null
          created_at?: string | null
          error_message?: string | null
          extraction_status?: string
          facebook_content?: string | null
          generated_image_url?: string | null
          heygen_video_id?: string | null
          id?: string
          image_status?: string
          instagram_content?: string | null
          linkedin_content?: string | null
          notes?: string | null
          publish_results?: Json | null
          published_at?: string | null
          scheduled_date?: string | null
          source_url?: string | null
          status?: string
          threads_content?: string | null
          tiktok_content?: string | null
          twitter_content?: string | null
          updated_at?: string | null
          user_id: string
          video_caption?: string | null
          video_script?: string | null
          video_status?: string
          video_url?: string | null
        }
        Update: {
          article_text?: string | null
          article_title?: string | null
          created_at?: string | null
          error_message?: string | null
          extraction_status?: string
          facebook_content?: string | null
          generated_image_url?: string | null
          heygen_video_id?: string | null
          id?: string
          image_status?: string
          instagram_content?: string | null
          linkedin_content?: string | null
          notes?: string | null
          publish_results?: Json | null
          published_at?: string | null
          scheduled_date?: string | null
          source_url?: string | null
          status?: string
          threads_content?: string | null
          tiktok_content?: string | null
          twitter_content?: string | null
          updated_at?: string | null
          user_id?: string
          video_caption?: string | null
          video_script?: string | null
          video_status?: string
          video_url?: string | null
        }
        Relationships: []
      }
      mavis_tacit: {
        Row: {
          category: string
          confidence: number | null
          created_at: string | null
          id: string
          key: string
          source: string | null
          updated_at: string | null
          user_id: string
          value: string
        }
        Insert: {
          category: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          key: string
          source?: string | null
          updated_at?: string | null
          user_id: string
          value: string
        }
        Update: {
          category?: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          key?: string
          source?: string | null
          updated_at?: string | null
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      mavis_tasks: {
        Row: {
          completed_at: string | null
          created_at: string | null
          description: string | null
          id: string
          payload: Json | null
          result: Json | null
          revenue_generated: number | null
          scheduled_at: string | null
          started_at: string | null
          status: string
          type: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          payload?: Json | null
          result?: Json | null
          revenue_generated?: number | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          type: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          payload?: Json | null
          result?: Json | null
          revenue_generated?: number | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_terminal_sessions: {
        Row: {
          created_at: string
          cwd: string
          id: string
          label: string
          last_used_at: string
          sandbox_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cwd?: string
          id?: string
          label?: string
          last_used_at?: string
          sandbox_id: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cwd?: string
          id?: string
          label?: string
          last_used_at?: string
          sandbox_id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_tool_registry: {
        Row: {
          category: string
          created_at: string | null
          description: string
          enabled: boolean
          id: string
          last_used_at: string | null
          name: string
          parameters: Json
          requires_approval: boolean
          returns: Json | null
          timeout_ms: number | null
          updated_at: string | null
          usage_count: number | null
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string | null
          description: string
          enabled?: boolean
          id?: string
          last_used_at?: string | null
          name: string
          parameters?: Json
          requires_approval?: boolean
          returns?: Json | null
          timeout_ms?: number | null
          updated_at?: string | null
          usage_count?: number | null
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string
          enabled?: boolean
          id?: string
          last_used_at?: string | null
          name?: string
          parameters?: Json
          requires_approval?: boolean
          returns?: Json | null
          timeout_ms?: number | null
          updated_at?: string | null
          usage_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
      mavis_trigger_log: {
        Row: {
          actions_auto: number
          actions_queued: number
          agent_response: string | null
          context_summary: string | null
          id: string
          ran_at: string
          trigger_types: string[]
          user_id: string
        }
        Insert: {
          actions_auto?: number
          actions_queued?: number
          agent_response?: string | null
          context_summary?: string | null
          id?: string
          ran_at?: string
          trigger_types?: string[]
          user_id: string
        }
        Update: {
          actions_auto?: number
          actions_queued?: number
          agent_response?: string | null
          context_summary?: string | null
          id?: string
          ran_at?: string
          trigger_types?: string[]
          user_id?: string
        }
        Relationships: []
      }
      mavis_trigger_subscriptions: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          id: string
          last_checked_at: string | null
          trigger_type: string
          user_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          last_checked_at?: string | null
          trigger_type: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          last_checked_at?: string | null
          trigger_type?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_usage_log: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          created_at: string
          estimated_cost_usd: number
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          persona_id: string | null
          session_type: string
          user_id: string
        }
        Insert: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          created_at?: string
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          persona_id?: string | null
          session_type: string
          user_id: string
        }
        Update: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          created_at?: string
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          persona_id?: string | null
          session_type?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_user_integrations: {
        Row: {
          config: Json | null
          created_at: string
          id: string
          key_name: string
          key_value: string
          last_tested: string | null
          provider: string
          status: string | null
          updated_at: string
          user_id: string
          verified: boolean
        }
        Insert: {
          config?: Json | null
          created_at?: string
          id?: string
          key_name: string
          key_value?: string
          last_tested?: string | null
          provider: string
          status?: string | null
          updated_at?: string
          user_id: string
          verified?: boolean
        }
        Update: {
          config?: Json | null
          created_at?: string
          id?: string
          key_name?: string
          key_value?: string
          last_tested?: string | null
          provider?: string
          status?: string | null
          updated_at?: string
          user_id?: string
          verified?: boolean
        }
        Relationships: []
      }
      mavis_user_model: {
        Row: {
          communication_style: Json | null
          confidence_score: number | null
          core_values: string[] | null
          created_at: string | null
          decision_patterns: Json | null
          facets: Json | null
          id: string
          last_synthesized_at: string | null
          personality_summary: string | null
          primary_goals: string[] | null
          raw_synthesis: string | null
          session_count: number | null
          synthesis_version: number | null
          triggers: Json | null
          updated_at: string | null
          user_id: string
          working_style: Json | null
        }
        Insert: {
          communication_style?: Json | null
          confidence_score?: number | null
          core_values?: string[] | null
          created_at?: string | null
          decision_patterns?: Json | null
          facets?: Json | null
          id?: string
          last_synthesized_at?: string | null
          personality_summary?: string | null
          primary_goals?: string[] | null
          raw_synthesis?: string | null
          session_count?: number | null
          synthesis_version?: number | null
          triggers?: Json | null
          updated_at?: string | null
          user_id: string
          working_style?: Json | null
        }
        Update: {
          communication_style?: Json | null
          confidence_score?: number | null
          core_values?: string[] | null
          created_at?: string | null
          decision_patterns?: Json | null
          facets?: Json | null
          id?: string
          last_synthesized_at?: string | null
          personality_summary?: string | null
          primary_goals?: string[] | null
          raw_synthesis?: string | null
          session_count?: number | null
          synthesis_version?: number | null
          triggers?: Json | null
          updated_at?: string | null
          user_id?: string
          working_style?: Json | null
        }
        Relationships: []
      }
      mavis_vault: {
        Row: {
          attachments: string[]
          category: string
          content: string
          created_at: string
          id: string
          importance: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attachments?: string[]
          category?: string
          content?: string
          created_at?: string
          id?: string
          importance?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attachments?: string[]
          category?: string
          content?: string
          created_at?: string
          id?: string
          importance?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mavis_video_jobs: {
        Row: {
          aspect_ratio: string | null
          completed_at: string | null
          created_at: string | null
          duration_seconds: number | null
          error_message: string | null
          id: string
          operation_name: string | null
          prompt: string
          provider: string
          request_id: string | null
          status: string
          user_id: string
          video_url: string | null
        }
        Insert: {
          aspect_ratio?: string | null
          completed_at?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          operation_name?: string | null
          prompt: string
          provider: string
          request_id?: string | null
          status?: string
          user_id: string
          video_url?: string | null
        }
        Update: {
          aspect_ratio?: string | null
          completed_at?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          operation_name?: string | null
          prompt?: string
          provider?: string
          request_id?: string | null
          status?: string
          user_id?: string
          video_url?: string | null
        }
        Relationships: []
      }
      memories: {
        Row: {
          content: string
          created_at: string
          id: string
          memory_type: string
          metadata: Json
          source: string
          tags: string[]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          memory_type?: string
          metadata?: Json
          source?: string
          tags?: string[]
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          memory_type?: string
          metadata?: Json
          source?: string
          tags?: string[]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nora_content_queue: {
        Row: {
          ai_generated: boolean | null
          content: string
          created_at: string | null
          hashtags: string[] | null
          id: string
          performance_data: Json | null
          platform: string
          posted_at: string | null
          scheduled_for: string | null
          source_topic: string | null
          status: string
          user_id: string
        }
        Insert: {
          ai_generated?: boolean | null
          content: string
          created_at?: string | null
          hashtags?: string[] | null
          id?: string
          performance_data?: Json | null
          platform: string
          posted_at?: string | null
          scheduled_for?: string | null
          source_topic?: string | null
          status?: string
          user_id: string
        }
        Update: {
          ai_generated?: boolean | null
          content?: string
          created_at?: string | null
          hashtags?: string[] | null
          id?: string
          performance_data?: Json | null
          platform?: string
          posted_at?: string | null
          scheduled_for?: string | null
          source_topic?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_budget: {
        Row: {
          created_at: string | null
          date: string
          id: string
          slots_total: number
          slots_used: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          date?: string
          id?: string
          slots_total?: number
          slots_used?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          slots_total?: number
          slots_used?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          body: string | null
          id: string
          opened: boolean | null
          opened_at: string | null
          priority: number
          sent_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          id?: string
          opened?: boolean | null
          opened_at?: string | null
          priority?: number
          sent_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          id?: string
          opened?: boolean | null
          opened_at?: string | null
          priority?: number
          sent_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_stages: {
        Row: {
          dedupe_key: string
          event_ref: string | null
          expires_at: string
          id: string
          sent_at: string | null
          stage: string
          user_id: string
        }
        Insert: {
          dedupe_key: string
          event_ref?: string | null
          expires_at: string
          id?: string
          sent_at?: string | null
          stage: string
          user_id: string
        }
        Update: {
          dedupe_key?: string
          event_ref?: string | null
          expires_at?: string
          id?: string
          sent_at?: string | null
          stage?: string
          user_id?: string
        }
        Relationships: []
      }
      omnisync_snapshots: {
        Row: {
          condensed_comms: string
          created_at: string
          id: string
          snapshot_data: Json
          summary: string
          user_id: string
        }
        Insert: {
          condensed_comms?: string
          created_at?: string
          id?: string
          snapshot_data?: Json
          summary?: string
          user_id: string
        }
        Update: {
          condensed_comms?: string
          created_at?: string
          id?: string
          snapshot_data?: Json
          summary?: string
          user_id?: string
        }
        Relationships: []
      }
      persona_content: {
        Row: {
          body: string
          content_type: string
          created_at: string | null
          engagement_score: number | null
          id: string
          persona_id: string
          platform: string | null
          published_at: string | null
          revenue_generated: number | null
          status: string | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          body: string
          content_type?: string
          created_at?: string | null
          engagement_score?: number | null
          id?: string
          persona_id: string
          platform?: string | null
          published_at?: string | null
          revenue_generated?: number | null
          status?: string | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          body?: string
          content_type?: string
          created_at?: string | null
          engagement_score?: number | null
          id?: string
          persona_id?: string
          platform?: string | null
          published_at?: string | null
          revenue_generated?: number | null
          status?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      persona_conversations: {
        Row: {
          content: string
          created_at: string
          id: string
          persona_id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          persona_id: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          persona_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "persona_conversations_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_memories: {
        Row: {
          content: string
          created_at: string
          id: string
          importance: number
          memory_type: string
          persona_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          importance?: number
          memory_type: string
          persona_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          importance?: number
          memory_type?: string
          persona_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "persona_memories_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_revenue: {
        Row: {
          amount: number
          content_id: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          id: string
          persona_id: string
          source: string
          stripe_payment_id: string | null
          user_id: string
        }
        Insert: {
          amount?: number
          content_id?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          persona_id: string
          source: string
          stripe_payment_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          content_id?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          persona_id?: string
          source?: string
          stripe_payment_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      personas: {
        Row: {
          agent_folders: Json
          archetype: string
          avatar_key: string | null
          can_join_council: boolean | null
          content_niche: string | null
          created_at: string
          data_access_tier: string | null
          embodiment_endpoint: string | null
          id: string
          is_active: boolean
          model: string
          name: string
          personality: Json
          role: string
          system_prompt: string
          telegram_enabled: boolean | null
          timezone: string | null
          updated_at: string
          user_id: string
          voice_id: string | null
          voice_settings: Json
          voice_style: string | null
        }
        Insert: {
          agent_folders?: Json
          archetype: string
          avatar_key?: string | null
          can_join_council?: boolean | null
          content_niche?: string | null
          created_at?: string
          data_access_tier?: string | null
          embodiment_endpoint?: string | null
          id?: string
          is_active?: boolean
          model?: string
          name: string
          personality?: Json
          role: string
          system_prompt: string
          telegram_enabled?: boolean | null
          timezone?: string | null
          updated_at?: string
          user_id: string
          voice_id?: string | null
          voice_settings?: Json
          voice_style?: string | null
        }
        Update: {
          agent_folders?: Json
          archetype?: string
          avatar_key?: string | null
          can_join_council?: boolean | null
          content_niche?: string | null
          created_at?: string
          data_access_tier?: string | null
          embodiment_endpoint?: string | null
          id?: string
          is_active?: boolean
          model?: string
          name?: string
          personality?: Json
          role?: string
          system_prompt?: string
          telegram_enabled?: boolean | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
          voice_id?: string | null
          voice_settings?: Json
          voice_style?: string | null
        }
        Relationships: []
      }
      plaid_accounts: {
        Row: {
          account_id: string
          available_bal: number | null
          currency: string
          current_bal: number | null
          id: string
          item_id: string
          mask: string | null
          name: string
          official_name: string | null
          subtype: string | null
          type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          available_bal?: number | null
          currency?: string
          current_bal?: number | null
          id?: string
          item_id: string
          mask?: string | null
          name: string
          official_name?: string | null
          subtype?: string | null
          type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          available_bal?: number | null
          currency?: string
          current_bal?: number | null
          id?: string
          item_id?: string
          mask?: string | null
          name?: string
          official_name?: string | null
          subtype?: string | null
          type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_accounts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["item_id"]
          },
        ]
      }
      plaid_items: {
        Row: {
          access_token: string
          created_at: string
          id: string
          institution_name: string
          item_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          institution_name?: string
          item_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          institution_name?: string
          item_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      plaid_sync_cursors: {
        Row: {
          cursor: string
          item_id: string
          updated_at: string
        }
        Insert: {
          cursor: string
          item_id: string
          updated_at?: string
        }
        Update: {
          cursor?: string
          item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_sync_cursors_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "plaid_items"
            referencedColumns: ["item_id"]
          },
        ]
      }
      plaid_transactions: {
        Row: {
          account_id: string
          amount: number
          category: string
          created_at: string
          currency: string
          date: string
          id: string
          item_id: string
          merchant_name: string | null
          name: string
          pending: boolean
          raw: Json
          transaction_id: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          category?: string
          created_at?: string
          currency?: string
          date: string
          id?: string
          item_id: string
          merchant_name?: string | null
          name: string
          pending?: boolean
          raw?: Json
          transaction_id: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          category?: string
          created_at?: string
          currency?: string
          date?: string
          id?: string
          item_id?: string
          merchant_name?: string | null
          name?: string
          pending?: boolean
          raw?: Json
          transaction_id?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          arc_story: string
          aura: string
          aura_power: string
          avatar_url: string | null
          codex_integrity: number
          created_at: string
          current_bpm: number
          current_floor: number
          current_form: string
          display_name: string | null
          fatigue: number
          full_cowl_sync: number
          gpr: number
          id: string
          inscribed_name: string
          level: number
          notification_settings: Json
          onboarding_done: boolean
          operator_level: number
          operator_xp: number
          pvp_rating: number
          rank: string
          species_lineage: string[]
          stat_agi: number
          stat_cha: number
          stat_int: number
          timezone: string
          stat_lck: number
          stat_str: number
          stat_vit: number
          stat_wis: number
          territory_class: string
          territory_floors: string
          titles: string[]
          true_name: string | null
          xp: number
          xp_to_next_level: number
        }
        Insert: {
          arc_story?: string
          aura?: string
          aura_power?: string
          avatar_url?: string | null
          codex_integrity?: number
          created_at?: string
          current_bpm?: number
          current_floor?: number
          current_form?: string
          display_name?: string | null
          fatigue?: number
          full_cowl_sync?: number
          gpr?: number
          id: string
          inscribed_name?: string
          level?: number
          notification_settings?: Json
          onboarding_done?: boolean
          operator_level?: number
          operator_xp?: number
          pvp_rating?: number
          rank?: string
          species_lineage?: string[]
          stat_agi?: number
          stat_cha?: number
          stat_int?: number
          stat_lck?: number
          stat_str?: number
          stat_vit?: number
          stat_wis?: number
          territory_class?: string
          territory_floors?: string
          timezone?: string
          titles?: string[]
          true_name?: string | null
          xp?: number
          xp_to_next_level?: number
        }
        Update: {
          arc_story?: string
          aura?: string
          aura_power?: string
          avatar_url?: string | null
          codex_integrity?: number
          created_at?: string
          current_bpm?: number
          current_floor?: number
          current_form?: string
          display_name?: string | null
          fatigue?: number
          full_cowl_sync?: number
          gpr?: number
          id?: string
          inscribed_name?: string
          level?: number
          notification_settings?: Json
          onboarding_done?: boolean
          operator_level?: number
          operator_xp?: number
          pvp_rating?: number
          rank?: string
          species_lineage?: string[]
          stat_agi?: number
          stat_cha?: number
          stat_int?: number
          stat_lck?: number
          stat_str?: number
          stat_vit?: number
          timezone?: string
          stat_wis?: number
          territory_class?: string
          territory_floors?: string
          titles?: string[]
          true_name?: string | null
          xp?: number
          xp_to_next_level?: number
        }
        Relationships: []
      }
      quests: {
        Row: {
          buff_effects: Json
          category: string | null
          codex_points_reward: number
          consequence_quest_id: string | null
          created_at: string
          deadline: string | null
          debuff_effects: Json
          description: string
          difficulty: string
          difficulty_rating: number | null
          id: string
          is_consequence: boolean | null
          linked_skill_ids: string[]
          loot_rewards: Json
          parent_quest_id: string | null
          parent_task_id: string | null
          progress_current: number
          progress_target: number
          real_world_mapping: string | null
          status: string
          title: string
          type: string
          updated_at: string
          user_id: string
          xp_reward: number
        }
        Insert: {
          buff_effects?: Json
          category?: string | null
          codex_points_reward?: number
          consequence_quest_id?: string | null
          created_at?: string
          deadline?: string | null
          debuff_effects?: Json
          description?: string
          difficulty?: string
          difficulty_rating?: number | null
          id?: string
          is_consequence?: boolean | null
          linked_skill_ids?: string[]
          loot_rewards?: Json
          parent_quest_id?: string | null
          parent_task_id?: string | null
          progress_current?: number
          progress_target?: number
          real_world_mapping?: string | null
          status?: string
          title: string
          type?: string
          updated_at?: string
          user_id: string
          xp_reward?: number
        }
        Update: {
          buff_effects?: Json
          category?: string | null
          codex_points_reward?: number
          consequence_quest_id?: string | null
          created_at?: string
          deadline?: string | null
          debuff_effects?: Json
          description?: string
          difficulty?: string
          difficulty_rating?: number | null
          id?: string
          is_consequence?: boolean | null
          linked_skill_ids?: string[]
          loot_rewards?: Json
          parent_quest_id?: string | null
          parent_task_id?: string | null
          progress_current?: number
          progress_target?: number
          real_world_mapping?: string | null
          status?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
          xp_reward?: number
        }
        Relationships: [
          {
            foreignKeyName: "quests_consequence_quest_id_fkey"
            columns: ["consequence_quest_id"]
            isOneToOne: false
            referencedRelation: "quest_with_sub_count"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quests_consequence_quest_id_fkey"
            columns: ["consequence_quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quests_parent_quest_id_fkey"
            columns: ["parent_quest_id"]
            isOneToOne: false
            referencedRelation: "quest_with_sub_count"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quests_parent_quest_id_fkey"
            columns: ["parent_quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quests_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      rankings_profiles: {
        Row: {
          created_at: string
          display_name: string
          gpr: number
          id: string
          influence: string
          is_self: boolean
          jjk_grade: string
          level: number
          notes: string
          op_tier: string
          pvp: number
          rank: string
          role: string
          source_transformation_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          gpr?: number
          id?: string
          influence?: string
          is_self?: boolean
          jjk_grade?: string
          level?: number
          notes?: string
          op_tier?: string
          pvp?: number
          rank?: string
          role?: string
          source_transformation_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          gpr?: number
          id?: string
          influence?: string
          is_self?: boolean
          jjk_grade?: string
          level?: number
          notes?: string
          op_tier?: string
          pvp?: number
          rank?: string
          role?: string
          source_transformation_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reclaim_schedule_blocks: {
        Row: {
          block_type: string | null
          end_time: string
          health_triggered: boolean | null
          id: string
          reclaim_task_id: string | null
          start_time: string
          synced_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          block_type?: string | null
          end_time: string
          health_triggered?: boolean | null
          id?: string
          reclaim_task_id?: string | null
          start_time: string
          synced_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          block_type?: string | null
          end_time?: string
          health_triggered?: boolean | null
          id?: string
          reclaim_task_id?: string | null
          start_time?: string
          synced_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      relationship_states: {
        Row: {
          bond_level: number
          created_at: string
          current_mood: string
          id: string
          last_interaction_at: string | null
          mood_reason: string | null
          persona_id: string
          total_interactions: number
          trust_level: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bond_level?: number
          created_at?: string
          current_mood?: string
          id?: string
          last_interaction_at?: string | null
          mood_reason?: string | null
          persona_id: string
          total_interactions?: number
          trust_level?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bond_level?: number
          created_at?: string
          current_mood?: string
          id?: string
          last_interaction_at?: string | null
          mood_reason?: string | null
          persona_id?: string
          total_interactions?: number
          trust_level?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "relationship_states_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      rituals: {
        Row: {
          category: string | null
          completed: boolean
          created_at: string
          description: string
          id: string
          last_completed: string | null
          name: string
          streak: number
          type: string
          updated_at: string
          user_id: string
          xp_reward: number
        }
        Insert: {
          category?: string | null
          completed?: boolean
          created_at?: string
          description?: string
          id?: string
          last_completed?: string | null
          name: string
          streak?: number
          type?: string
          updated_at?: string
          user_id: string
          xp_reward?: number
        }
        Update: {
          category?: string | null
          completed?: boolean
          created_at?: string
          description?: string
          id?: string
          last_completed?: string | null
          name?: string
          streak?: number
          type?: string
          updated_at?: string
          user_id?: string
          xp_reward?: number
        }
        Relationships: []
      }
      screenpipe_sync_log: {
        Row: {
          context_window_minutes: number | null
          id: string
          items_synced: number | null
          memories_created: number | null
          synced_at: string | null
          user_id: string
        }
        Insert: {
          context_window_minutes?: number | null
          id?: string
          items_synced?: number | null
          memories_created?: number | null
          synced_at?: string | null
          user_id: string
        }
        Update: {
          context_window_minutes?: number | null
          id?: string
          items_synced?: number | null
          memories_created?: number | null
          synced_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      skills: {
        Row: {
          category: string
          cost: number
          created_at: string
          description: string
          energy_type: string
          id: string
          name: string
          parent_skill_id: string | null
          prerequisites: string[]
          proficiency: number
          tier: number
          unlocked: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          cost?: number
          created_at?: string
          description?: string
          energy_type?: string
          id?: string
          name: string
          parent_skill_id?: string | null
          prerequisites?: string[]
          proficiency?: number
          tier?: number
          unlocked?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          cost?: number
          created_at?: string
          description?: string
          energy_type?: string
          id?: string
          name?: string
          parent_skill_id?: string | null
          prerequisites?: string[]
          proficiency?: number
          tier?: number
          unlocked?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skills_parent_skill_id_fkey"
            columns: ["parent_skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      standing_order_templates: {
        Row: {
          category: string | null
          created_at: string | null
          created_by_agent: boolean | null
          cron_expression: string | null
          description: string | null
          id: string
          instructions: string
          last_used_at: string | null
          name: string
          next_run_at: string | null
          slug: string
          status: string | null
          success_count: number | null
          tags: string[] | null
          updated_at: string | null
          usage_count: number | null
          user_id: string
          version: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          created_by_agent?: boolean | null
          cron_expression?: string | null
          description?: string | null
          id?: string
          instructions: string
          last_used_at?: string | null
          name: string
          next_run_at?: string | null
          slug: string
          status?: string | null
          success_count?: number | null
          tags?: string[] | null
          updated_at?: string | null
          usage_count?: number | null
          user_id: string
          version?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          created_by_agent?: boolean | null
          cron_expression?: string | null
          description?: string | null
          id?: string
          instructions?: string
          last_used_at?: string | null
          name?: string
          next_run_at?: string | null
          slug?: string
          status?: string | null
          success_count?: number | null
          tags?: string[] | null
          updated_at?: string | null
          usage_count?: number | null
          user_id?: string
          version?: number | null
        }
        Relationships: []
      }
      store_items: {
        Row: {
          category: string
          created_at: string
          currency: string
          description: string
          effect: string | null
          id: string
          name: string
          price: number
          rarity: string
          req_level: number | null
          req_rank: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          currency?: string
          description?: string
          effect?: string | null
          id?: string
          name: string
          price?: number
          rarity?: string
          req_level?: number | null
          req_rank?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          currency?: string
          description?: string
          effect?: string | null
          id?: string
          name?: string
          price?: number
          rarity?: string
          req_level?: number | null
          req_rank?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      streak_insurance: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          quest_id: string | null
          status: string
          task_id: string | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string
          id?: string
          quest_id?: string | null
          status?: string
          task_id?: string | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          quest_id?: string | null
          status?: string
          task_id?: string | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "streak_insurance_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quest_with_sub_count"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streak_insurance_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streak_insurance_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          id: string
          processed_at: string | null
          type: string
        }
        Insert: {
          id: string
          processed_at?: string | null
          type: string
        }
        Update: {
          id?: string
          processed_at?: string | null
          type?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          completed_count: number
          created_at: string
          description: string | null
          id: string
          last_completed: string | null
          linked_skill_id: string | null
          recurrence: string
          status: string
          streak: number
          title: string
          type: string
          updated_at: string
          user_id: string
          xp_reward: number
        }
        Insert: {
          completed_count?: number
          created_at?: string
          description?: string | null
          id?: string
          last_completed?: string | null
          linked_skill_id?: string | null
          recurrence?: string
          status?: string
          streak?: number
          title: string
          type?: string
          updated_at?: string
          user_id: string
          xp_reward?: number
        }
        Update: {
          completed_count?: number
          created_at?: string
          description?: string | null
          id?: string
          last_completed?: string | null
          linked_skill_id?: string | null
          recurrence?: string
          status?: string
          streak?: number
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
          xp_reward?: number
        }
        Relationships: []
      }
      tower_floors: {
        Row: {
          created_at: string | null
          dangers: string
          ecology: string
          energy: string
          essence: string
          floor_max: number
          floor_min: number
          function: string
          id: string
          inhabitants: string
          law: string
          name: string
          rewards: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          dangers?: string
          ecology?: string
          energy?: string
          essence?: string
          floor_max: number
          floor_min: number
          function?: string
          id?: string
          inhabitants?: string
          law?: string
          name?: string
          rewards?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          dangers?: string
          ecology?: string
          energy?: string
          essence?: string
          floor_max?: number
          floor_min?: number
          function?: string
          id?: string
          inhabitants?: string
          law?: string
          name?: string
          rewards?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tower_floors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tower_subareas: {
        Row: {
          area_type: string
          created_at: string | null
          description: string
          floor_end: number | null
          floor_id: string
          floor_start: number | null
          id: string
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          area_type?: string
          created_at?: string | null
          description?: string
          floor_end?: number | null
          floor_id: string
          floor_start?: number | null
          id?: string
          name?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          area_type?: string
          created_at?: string | null
          description?: string
          floor_end?: number | null
          floor_id?: string
          floor_start?: number | null
          id?: string
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tower_subareas_floor_id_fkey"
            columns: ["floor_id"]
            isOneToOne: false
            referencedRelation: "tower_floors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tower_subareas_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transformations: {
        Row: {
          abilities: Json
          active_buffs: Json
          bpm_range: string
          category: string | null
          created_at: string
          description: string | null
          energy: string
          form_order: number
          id: string
          jjk_grade: string
          name: string
          op_tier: string
          passive_buffs: Json
          tier: string
          unlocked: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          abilities?: Json
          active_buffs?: Json
          bpm_range?: string
          category?: string | null
          created_at?: string
          description?: string | null
          energy?: string
          form_order?: number
          id?: string
          jjk_grade?: string
          name: string
          op_tier?: string
          passive_buffs?: Json
          tier: string
          unlocked?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          abilities?: Json
          active_buffs?: Json
          bpm_range?: string
          category?: string | null
          created_at?: string
          description?: string | null
          energy?: string
          form_order?: number
          id?: string
          jjk_grade?: string
          name?: string
          op_tier?: string
          passive_buffs?: Json
          tier?: string
          unlocked?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tutoring_sessions: {
        Row: {
          created_at: string | null
          current_problem: string | null
          hints_used: number | null
          id: string
          messages: Json | null
          solved: boolean | null
          subject: string
          time_spent_seconds: number | null
          topic_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_problem?: string | null
          hints_used?: number | null
          id?: string
          messages?: Json | null
          solved?: boolean | null
          subject: string
          time_spent_seconds?: number | null
          topic_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_problem?: string | null
          hints_used?: number | null
          id?: string
          messages?: Json | null
          solved?: boolean | null
          subject?: string
          time_spent_seconds?: number | null
          topic_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_difficulty_profile: {
        Row: {
          avg_completion: number
          current_level: number
          last_adjusted: string | null
          streak_avg: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          avg_completion?: number
          current_level?: number
          last_adjusted?: string | null
          streak_avg?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          avg_completion?: number
          current_level?: number
          last_adjusted?: string | null
          streak_avg?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vault_entries: {
        Row: {
          attachments: string[]
          category: string
          content: string
          created_at: string
          id: string
          importance: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attachments?: string[]
          category?: string
          content?: string
          created_at?: string
          id?: string
          importance?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attachments?: string[]
          category?: string
          content?: string
          created_at?: string
          id?: string
          importance?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vault_media: {
        Row: {
          created_at: string
          description: string
          file_name: string
          file_size: number
          file_type: string
          file_url: string
          id: string
          tags: string[]
          user_id: string
          vault_entry_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string
          file_name: string
          file_size?: number
          file_type?: string
          file_url: string
          id?: string
          tags?: string[]
          user_id: string
          vault_entry_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          file_name?: string
          file_size?: number
          file_type?: string
          file_url?: string
          id?: string
          tags?: string[]
          user_id?: string
          vault_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_media_vault_entry_id_fkey"
            columns: ["vault_entry_id"]
            isOneToOne: false
            referencedRelation: "vault_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      video_clips: {
        Row: {
          aspect_ratio: string | null
          caption_words: Json | null
          created_at: string | null
          duration_seconds: number | null
          end_seconds: number
          format: string
          id: string
          nora_queued: boolean | null
          project_id: string
          render_job_id: string | null
          render_status: string | null
          render_url: string | null
          source_url: string | null
          start_seconds: number
          suggested_caption: string | null
          suggested_hashtags: string[] | null
          thumbnail_url: string | null
          title: string
          transcript_excerpt: string | null
          user_id: string
          viral_score: number | null
          why_viral: string | null
        }
        Insert: {
          aspect_ratio?: string | null
          caption_words?: Json | null
          created_at?: string | null
          duration_seconds?: number | null
          end_seconds: number
          format: string
          id?: string
          nora_queued?: boolean | null
          project_id: string
          render_job_id?: string | null
          render_status?: string | null
          render_url?: string | null
          source_url?: string | null
          start_seconds: number
          suggested_caption?: string | null
          suggested_hashtags?: string[] | null
          thumbnail_url?: string | null
          title: string
          transcript_excerpt?: string | null
          user_id: string
          viral_score?: number | null
          why_viral?: string | null
        }
        Update: {
          aspect_ratio?: string | null
          caption_words?: Json | null
          created_at?: string | null
          duration_seconds?: number | null
          end_seconds?: number
          format?: string
          id?: string
          nora_queued?: boolean | null
          project_id?: string
          render_job_id?: string | null
          render_status?: string | null
          render_url?: string | null
          source_url?: string | null
          start_seconds?: number
          suggested_caption?: string | null
          suggested_hashtags?: string[] | null
          thumbnail_url?: string | null
          title?: string
          transcript_excerpt?: string | null
          user_id?: string
          viral_score?: number | null
          why_viral?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_clips_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "video_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      video_projects: {
        Row: {
          created_at: string | null
          duration_seconds: number | null
          gemini_analysis: Json | null
          id: string
          language: string | null
          source_type: string | null
          source_url: string | null
          status: string | null
          storage_path: string | null
          summary: string | null
          thumbnail_url: string | null
          title: string
          transcript: string | null
          transcript_chunks: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          duration_seconds?: number | null
          gemini_analysis?: Json | null
          id?: string
          language?: string | null
          source_type?: string | null
          source_url?: string | null
          status?: string | null
          storage_path?: string | null
          summary?: string | null
          thumbnail_url?: string | null
          title: string
          transcript?: string | null
          transcript_chunks?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          duration_seconds?: number | null
          gemini_analysis?: Json | null
          id?: string
          language?: string | null
          source_type?: string | null
          source_url?: string | null
          status?: string | null
          storage_path?: string | null
          summary?: string | null
          thumbnail_url?: string | null
          title?: string
          transcript?: string | null
          transcript_chunks?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      video_quota: {
        Row: {
          analyses_limit: number
          analyses_used: number
          id: string
          period_start: string
          renders_limit: number
          renders_used: number
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          analyses_limit?: number
          analyses_used?: number
          id?: string
          period_start?: string
          renders_limit?: number
          renders_used?: number
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          analyses_limit?: number
          analyses_used?: number
          id?: string
          period_start?: string
          renders_limit?: number
          renders_used?: number
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      video_render_jobs: {
        Row: {
          clip_id: string | null
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          ffmpeg_cmd: string | null
          id: string
          input_url: string | null
          output_url: string | null
          progress: number | null
          project_id: string | null
          provider: string | null
          provider_job_id: string | null
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          clip_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          ffmpeg_cmd?: string | null
          id?: string
          input_url?: string | null
          output_url?: string | null
          progress?: number | null
          project_id?: string | null
          provider?: string | null
          provider_job_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          clip_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          ffmpeg_cmd?: string | null
          id?: string
          input_url?: string | null
          output_url?: string | null
          progress?: number | null
          project_id?: string | null
          provider?: string | null
          provider_job_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_render_jobs_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "video_clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_render_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "video_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      video_segments: {
        Row: {
          end_seconds: number
          id: string
          project_id: string
          score_emotion: number | null
          score_energy: number | null
          score_hook: number | null
          score_insight: number | null
          score_quotability: number | null
          score_visual: number | null
          segment_order: number
          start_seconds: number
          transcript_text: string | null
          user_id: string
          viral_score: number | null
        }
        Insert: {
          end_seconds: number
          id?: string
          project_id: string
          score_emotion?: number | null
          score_energy?: number | null
          score_hook?: number | null
          score_insight?: number | null
          score_quotability?: number | null
          score_visual?: number | null
          segment_order: number
          start_seconds: number
          transcript_text?: string | null
          user_id: string
          viral_score?: number | null
        }
        Update: {
          end_seconds?: number
          id?: string
          project_id?: string
          score_emotion?: number | null
          score_energy?: number | null
          score_hook?: number | null
          score_insight?: number | null
          score_quotability?: number | null
          score_visual?: number | null
          segment_order?: number
          start_seconds?: number
          transcript_text?: string | null
          user_id?: string
          viral_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "video_segments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "video_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      watchtower_briefs: {
        Row: {
          brief_date: string
          content: string
          created_at: string
          id: string
          read: boolean
          summary: string
          user_id: string
        }
        Insert: {
          brief_date?: string
          content: string
          created_at?: string
          id?: string
          read?: boolean
          summary?: string
          user_id: string
        }
        Update: {
          brief_date?: string
          content?: string
          created_at?: string
          id?: string
          read?: boolean
          summary?: string
          user_id?: string
        }
        Relationships: []
      }
      wearable_overlay_history: {
        Row: {
          content: string
          device_type: string
          displayed_at: string | null
          duration_ms: number | null
          id: string
          overlay_type: string | null
          user_id: string
        }
        Insert: {
          content: string
          device_type: string
          displayed_at?: string | null
          duration_ms?: number | null
          id?: string
          overlay_type?: string | null
          user_id: string
        }
        Update: {
          content?: string
          device_type?: string
          displayed_at?: string | null
          duration_ms?: number | null
          id?: string
          overlay_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      website_clients: {
        Row: {
          business_name: string | null
          business_type: string | null
          client_email: string | null
          client_name: string
          client_phone: string | null
          created_at: string | null
          id: string
          location: string | null
          notes: string | null
          project_count: number | null
          total_value_cents: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          business_name?: string | null
          business_type?: string | null
          client_email?: string | null
          client_name: string
          client_phone?: string | null
          created_at?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          project_count?: number | null
          total_value_cents?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          business_name?: string | null
          business_type?: string | null
          client_email?: string | null
          client_name?: string
          client_phone?: string | null
          created_at?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          project_count?: number | null
          total_value_cents?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      website_form_submissions: {
        Row: {
          created_at: string
          data: Json
          form_type: string
          id: string
          ip_address: string | null
          notified: boolean
          project_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          form_type?: string
          id?: string
          ip_address?: string | null
          notified?: boolean
          project_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          form_type?: string
          id?: string
          ip_address?: string | null
          notified?: boolean
          project_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_form_submissions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "website_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      website_generation_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_step: string | null
          error_message: string | null
          id: string
          project_id: string
          result: Json | null
          started_at: string | null
          status: string
          steps_completed: number | null
          steps_total: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_step?: string | null
          error_message?: string | null
          id?: string
          project_id: string
          result?: Json | null
          started_at?: string | null
          status?: string
          steps_completed?: number | null
          steps_total?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_step?: string | null
          error_message?: string | null
          id?: string
          project_id?: string
          result?: Json | null
          started_at?: string | null
          status?: string
          steps_completed?: number | null
          steps_total?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_generation_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "website_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      website_pages: {
        Row: {
          blocks_json: string | null
          content_brief: string | null
          created_at: string | null
          gutenberg_html: string | null
          hero_image_url: string | null
          id: string
          meta_description: string | null
          meta_title: string | null
          page_type: string
          project_id: string
          published_at: string | null
          seo_score: number | null
          slug: string | null
          status: string | null
          title: string | null
          user_id: string
          wp_page_id: number | null
          wp_url: string | null
        }
        Insert: {
          blocks_json?: string | null
          content_brief?: string | null
          created_at?: string | null
          gutenberg_html?: string | null
          hero_image_url?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          page_type: string
          project_id: string
          published_at?: string | null
          seo_score?: number | null
          slug?: string | null
          status?: string | null
          title?: string | null
          user_id: string
          wp_page_id?: number | null
          wp_url?: string | null
        }
        Update: {
          blocks_json?: string | null
          content_brief?: string | null
          created_at?: string | null
          gutenberg_html?: string | null
          hero_image_url?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          page_type?: string
          project_id?: string
          published_at?: string | null
          seo_score?: number | null
          slug?: string | null
          status?: string | null
          title?: string | null
          user_id?: string
          wp_page_id?: number | null
          wp_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "website_pages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "website_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      website_projects: {
        Row: {
          business_name: string | null
          business_type: string | null
          client_id: string | null
          client_name: string | null
          color_scheme: string | null
          created_at: string | null
          delivered_at: string | null
          description: string | null
          hero_image_url: string | null
          id: string
          location: string | null
          netlify_deploy_id: string | null
          netlify_deploy_status: string | null
          netlify_site_id: string | null
          netlify_site_url: string | null
          pages: string[] | null
          pages_count: number | null
          pages_requested: string[] | null
          paid: boolean | null
          preview_url: string | null
          price_cents: number | null
          project_name: string
          published_at: string | null
          site_content: Json | null
          status: string
          style: string | null
          target_audience: string | null
          unique_value: string | null
          updated_at: string | null
          user_id: string
          wp_app_password: string | null
          wp_site_url: string | null
          wp_username: string | null
        }
        Insert: {
          business_name?: string | null
          business_type?: string | null
          client_id?: string | null
          client_name?: string | null
          color_scheme?: string | null
          created_at?: string | null
          delivered_at?: string | null
          description?: string | null
          hero_image_url?: string | null
          id?: string
          location?: string | null
          netlify_deploy_id?: string | null
          netlify_deploy_status?: string | null
          netlify_site_id?: string | null
          netlify_site_url?: string | null
          pages?: string[] | null
          pages_count?: number | null
          pages_requested?: string[] | null
          paid?: boolean | null
          preview_url?: string | null
          price_cents?: number | null
          project_name: string
          published_at?: string | null
          site_content?: Json | null
          status?: string
          style?: string | null
          target_audience?: string | null
          unique_value?: string | null
          updated_at?: string | null
          user_id: string
          wp_app_password?: string | null
          wp_site_url?: string | null
          wp_username?: string | null
        }
        Update: {
          business_name?: string | null
          business_type?: string | null
          client_id?: string | null
          client_name?: string | null
          color_scheme?: string | null
          created_at?: string | null
          delivered_at?: string | null
          description?: string | null
          hero_image_url?: string | null
          id?: string
          location?: string | null
          netlify_deploy_id?: string | null
          netlify_deploy_status?: string | null
          netlify_site_id?: string | null
          netlify_site_url?: string | null
          pages?: string[] | null
          pages_count?: number | null
          pages_requested?: string[] | null
          paid?: boolean | null
          preview_url?: string | null
          price_cents?: number | null
          project_name?: string
          published_at?: string | null
          site_content?: Json | null
          status?: string
          style?: string | null
          target_audience?: string | null
          unique_value?: string | null
          updated_at?: string | null
          user_id?: string
          wp_app_password?: string | null
          wp_site_url?: string | null
          wp_username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "website_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "website_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      website_service_tiers: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          includes_blog: boolean | null
          includes_ecommerce: boolean | null
          includes_revisions: number | null
          includes_seo: boolean | null
          is_active: boolean | null
          pages_included: number | null
          price_cents: number
          tier_name: string
          turnaround_days: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          includes_blog?: boolean | null
          includes_ecommerce?: boolean | null
          includes_revisions?: number | null
          includes_seo?: boolean | null
          is_active?: boolean | null
          pages_included?: number | null
          price_cents: number
          tier_name: string
          turnaround_days?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          includes_blog?: boolean | null
          includes_ecommerce?: boolean | null
          includes_revisions?: number | null
          includes_seo?: boolean | null
          is_active?: boolean | null
          pages_included?: number | null
          price_cents?: number
          tier_name?: string
          turnaround_days?: number | null
          user_id?: string
        }
        Relationships: []
      }
      whoop_daily_data: {
        Row: {
          biomarkers: Json | null
          calories: number | null
          date: string
          hrv_rmssd: number | null
          id: string
          raw_data: Json | null
          recovery_score: number | null
          resting_hr: number | null
          sleep_hours: number | null
          sleep_performance: number | null
          strain_score: number | null
          synced_at: string | null
          user_id: string
        }
        Insert: {
          biomarkers?: Json | null
          calories?: number | null
          date: string
          hrv_rmssd?: number | null
          id?: string
          raw_data?: Json | null
          recovery_score?: number | null
          resting_hr?: number | null
          sleep_hours?: number | null
          sleep_performance?: number | null
          strain_score?: number | null
          synced_at?: string | null
          user_id: string
        }
        Update: {
          biomarkers?: Json | null
          calories?: number | null
          date?: string
          hrv_rmssd?: number | null
          id?: string
          raw_data?: Json | null
          recovery_score?: number | null
          resting_hr?: number | null
          sleep_hours?: number | null
          sleep_performance?: number | null
          strain_score?: number | null
          synced_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      whoop_tokens: {
        Row: {
          access_token: string
          created_at: string | null
          expires_at: string | null
          refresh_token: string | null
          scope: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string | null
          expires_at?: string | null
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string | null
          expires_at?: string | null
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      widget_chat_logs: {
        Row: {
          created_at: string | null
          id: string
          message: string
          reply: string
          response_ms: number | null
          session_id: string
          widget_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message: string
          reply: string
          response_ms?: number | null
          session_id: string
          widget_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message?: string
          reply?: string
          response_ms?: number | null
          session_id?: string
          widget_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "widget_chat_logs_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "widget_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      widget_instances: {
        Row: {
          business_context: string | null
          cancel_at_period_end: boolean | null
          config: Json
          created_at: string | null
          current_period_end: string | null
          id: string
          monthly_price_cents: number | null
          project_id: string | null
          public_url: string | null
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          total_conversations: number | null
          total_leads: number | null
          total_requests: number | null
          trial_ends_at: string | null
          updated_at: string | null
          user_id: string
          widget_type: string
        }
        Insert: {
          business_context?: string | null
          cancel_at_period_end?: boolean | null
          config?: Json
          created_at?: string | null
          current_period_end?: string | null
          id: string
          monthly_price_cents?: number | null
          project_id?: string | null
          public_url?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          total_conversations?: number | null
          total_leads?: number | null
          total_requests?: number | null
          trial_ends_at?: string | null
          updated_at?: string | null
          user_id: string
          widget_type: string
        }
        Update: {
          business_context?: string | null
          cancel_at_period_end?: boolean | null
          config?: Json
          created_at?: string | null
          current_period_end?: string | null
          id?: string
          monthly_price_cents?: number | null
          project_id?: string | null
          public_url?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          total_conversations?: number | null
          total_leads?: number | null
          total_requests?: number | null
          trial_ends_at?: string | null
          updated_at?: string | null
          user_id?: string
          widget_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "widget_instances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "website_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      widget_leads: {
        Row: {
          company: string | null
          contacted_at: string | null
          converted_at: string | null
          created_at: string | null
          email: string | null
          id: string
          lead_type: string
          message: string | null
          metadata: Json | null
          name: string | null
          phone: string | null
          source_url: string | null
          status: string
          widget_id: string
        }
        Insert: {
          company?: string | null
          contacted_at?: string | null
          converted_at?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          lead_type?: string
          message?: string | null
          metadata?: Json | null
          name?: string | null
          phone?: string | null
          source_url?: string | null
          status?: string
          widget_id: string
        }
        Update: {
          company?: string | null
          contacted_at?: string | null
          converted_at?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          lead_type?: string
          message?: string | null
          metadata?: Json | null
          name?: string | null
          phone?: string | null
          source_url?: string | null
          status?: string
          widget_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "widget_leads_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "widget_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      widget_usage_stats: {
        Row: {
          action_type: string
          date: string
          request_count: number | null
          widget_id: string
        }
        Insert: {
          action_type: string
          date?: string
          request_count?: number | null
          widget_id: string
        }
        Update: {
          action_type?: string
          date?: string
          request_count?: number | null
          widget_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "widget_usage_stats_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "widget_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          completed_at: string | null
          id: string
          started_at: string | null
          status: string | null
          steps_log: Json | null
          user_id: string
          workflow_id: string | null
        }
        Insert: {
          completed_at?: string | null
          id?: string
          started_at?: string | null
          status?: string | null
          steps_log?: Json | null
          user_id: string
          workflow_id?: string | null
        }
        Update: {
          completed_at?: string | null
          id?: string
          started_at?: string | null
          status?: string | null
          steps_log?: Json | null
          user_id?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          last_run_at: string | null
          last_run_status: string | null
          name: string
          steps: Json | null
          trigger_config: Json | null
          trigger_type: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          last_run_status?: string | null
          name: string
          steps?: Json | null
          trigger_config?: Json | null
          trigger_type?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          last_run_status?: string | null
          name?: string
          steps?: Json | null
          trigger_config?: Json | null
          trigger_type?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          color: string
          created_at: string
          description: string
          icon: string
          id: string
          is_active: boolean
          name: string
          slug: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string
          icon?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string
          icon?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          user_id?: string
        }
        Relationships: []
      }
      wp_credentials: {
        Row: {
          app_password: string | null
          auth_type: string | null
          created_at: string | null
          id: string
          label: string | null
          last_used_at: string | null
          project_id: string | null
          site_url: string | null
          user_id: string
          verified: boolean | null
          wp_username: string | null
          wpcom_access_token: string | null
          wpcom_blog_id: number | null
          wpcom_site_domain: string | null
        }
        Insert: {
          app_password?: string | null
          auth_type?: string | null
          created_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          project_id?: string | null
          site_url?: string | null
          user_id: string
          verified?: boolean | null
          wp_username?: string | null
          wpcom_access_token?: string | null
          wpcom_blog_id?: number | null
          wpcom_site_domain?: string | null
        }
        Update: {
          app_password?: string | null
          auth_type?: string | null
          created_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          project_id?: string | null
          site_url?: string | null
          user_id?: string
          verified?: boolean | null
          wp_username?: string | null
          wpcom_access_token?: string | null
          wpcom_blog_id?: number | null
          wpcom_site_domain?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wp_credentials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "website_projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      emotion_weekly_trends: {
        Row: {
          avg_anxiety: number | null
          avg_determination: number | null
          avg_excitement: number | null
          avg_focus: number | null
          avg_frustration: number | null
          avg_gratitude: number | null
          avg_joy: number | null
          avg_pride: number | null
          avg_sadness: number | null
          avg_tiredness: number | null
          dominant_emotion: string | null
          entry_count: number | null
          user_id: string | null
          week: string | null
        }
        Relationships: []
      }
      mavis_provider_stats: {
        Row: {
          avg_latency_ms: number | null
          avg_tokens: number | null
          error_count: number | null
          last_used_at: string | null
          max_latency_ms: number | null
          min_latency_ms: number | null
          mode: string | null
          provider: string | null
          success_rate_pct: number | null
          total_calls: number | null
          total_cost_usd: number | null
          total_tokens: number | null
          user_id: string | null
        }
        Relationships: []
      }
      quest_with_sub_count: {
        Row: {
          active_sub_quest_count: number | null
          buff_effects: Json | null
          category: string | null
          codex_points_reward: number | null
          completed_sub_quest_count: number | null
          consequence_quest_id: string | null
          created_at: string | null
          deadline: string | null
          debuff_effects: Json | null
          description: string | null
          difficulty: string | null
          difficulty_rating: number | null
          id: string | null
          is_consequence: boolean | null
          linked_skill_ids: string[] | null
          loot_rewards: Json | null
          parent_quest_id: string | null
          parent_task_id: string | null
          progress_current: number | null
          progress_target: number | null
          real_world_mapping: string | null
          status: string | null
          title: string | null
          total_sub_quest_count: number | null
          type: string | null
          updated_at: string | null
          user_id: string | null
          xp_reward: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quests_consequence_quest_id_fkey"
            columns: ["consequence_quest_id"]
            isOneToOne: false
            referencedRelation: "quest_with_sub_count"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quests_consequence_quest_id_fkey"
            columns: ["consequence_quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quests_parent_quest_id_fkey"
            columns: ["parent_quest_id"]
            isOneToOne: false
            referencedRelation: "quest_with_sub_count"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quests_parent_quest_id_fkey"
            columns: ["parent_quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quests_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      widget_revenue_summary: {
        Row: {
          active_widgets: number | null
          mrr_cents: number | null
          total_api_requests: number | null
          total_leads_captured: number | null
          total_widgets: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      bump_memory_access: { Args: { memory_id: string }; Returns: undefined }
      consume_notification_slot: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      decay_old_memories: {
        Args: { p_days_threshold?: number; p_user_id: string }
        Returns: number
      }
      increment_tool_usage: {
        Args: { p_tool_name: string }
        Returns: undefined
      }
      increment_widget_usage: {
        Args: { p_action: string; p_widget_id: string }
        Returns: undefined
      }
      match_documents: {
        Args: {
          filter?: Json
          match_count?: number
          match_user_id: string
          query_embedding: string
        }
        Returns: {
          content: string
          id: number
          metadata: Json
          similarity: number
        }[]
      }
      match_mavis_notes: {
        Args: {
          match_count?: number
          match_threshold?: number
          match_user_id: string
          query_embedding: string
        }
        Returns: {
          content: string
          id: string
          similarity: number
          tags: string[]
          title: string
        }[]
      }
      match_persona_memory: {
        Args: {
          match_count?: number
          match_threshold?: number
          match_user_id: string
          query_embedding: string
        }
        Returns: {
          category: string
          importance: number
          key: string
          similarity: number
          value: string
        }[]
      }
      mavis_dispatch_event: { Args: { payload: Json }; Returns: undefined }
      mavis_log_cron_run: {
        Args: { p_code: number; p_job_name: string }
        Returns: undefined
      }
      search_mavis_memories: {
        Args: {
          match_count?: number
          match_threshold?: number
          match_user_id: string
          query_embedding: string
        }
        Returns: {
          content: string
          created_at: string
          id: number
          importance_score: number
          role: string
          similarity: number
        }[]
      }
      search_memories_hybrid: {
        Args: {
          match_count?: number
          match_user_id: string
          query_embedding: string
          query_text: string
        }
        Returns: {
          content: string
          created_at: string
          id: string
          importance: number
          memory_type: string
          score: number
          tags: string[]
        }[]
      }
      search_memories_semantic: {
        Args: {
          match_count?: number
          match_user_id: string
          query_embedding: string
        }
        Returns: {
          content: string
          created_at: string
          id: string
          importance: number
          memory_type: string
          similarity: number
          tags: string[]
        }[]
      }
    }
    Enums: {
      app_role: "owner" | "user"
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
    Enums: {
      app_role: ["owner", "user"],
    },
  },
} as const
