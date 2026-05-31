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
      council_sessions: {
        Row: {
          created_at: string | null
          id: string
          messages: Json | null
          participants: Json | null
          session_type: string | null
          summary: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          messages?: Json | null
          participants?: Json | null
          session_type?: string | null
          summary?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          messages?: Json | null
          participants?: Json | null
          session_type?: string | null
          summary?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      councils: {
        Row: {
          avatar: string | null
          can_be_summoned: boolean | null
          class: string
          created_at: string
          data_access_tier: string | null
          id: string
          name: string
          notes: string
          personality_prompt: string | null
          role: string
          specialty: string | null
          telegram_enabled: boolean | null
          updated_at: string
          user_id: string
          voice_id: string | null
          voice_settings: Json
          voice_style: string | null
        }
        Insert: {
          avatar?: string | null
          can_be_summoned?: boolean | null
          class?: string
          created_at?: string
          data_access_tier?: string | null
          id?: string
          name: string
          notes?: string
          personality_prompt?: string | null
          role?: string
          specialty?: string | null
          telegram_enabled?: boolean | null
          updated_at?: string
          user_id: string
          voice_id?: string | null
          voice_settings?: Json
          voice_style?: string | null
        }
        Update: {
          avatar?: string | null
          can_be_summoned?: boolean | null
          class?: string
          created_at?: string
          data_access_tier?: string | null
          id?: string
          name?: string
          notes?: string
          personality_prompt?: string | null
          role?: string
          specialty?: string | null
          telegram_enabled?: boolean | null
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
          id?: string
          importance_score?: number | null
          role?: string
          session_id?: string
          timestamp?: number
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
          properties: Json
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
          properties?: Json
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
          properties?: Json
          tags?: string[]
          title?: string
          updated_at?: string
          user_id?: string
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
      mavis_social_posts: {
        Row: {
          content: string
          created_at: string | null
          engagement: Json | null
          id: string
          persona: string
          platform: string
          posted_at: string | null
          status: string
          thread_parent_id: string | null
          tweet_id: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          engagement?: Json | null
          id?: string
          persona?: string
          platform?: string
          posted_at?: string | null
          status?: string
          thread_parent_id?: string | null
          tweet_id?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          engagement?: Json | null
          id?: string
          persona?: string
          platform?: string
          posted_at?: string | null
          status?: string
          thread_parent_id?: string | null
          tweet_id?: string | null
          user_id?: string
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
          updated_at: string
          user_id: string
          voice_id: string | null
          voice_settings: Json
          voice_style: string | null
        }
        Insert: {
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
          updated_at?: string
          user_id: string
          voice_id?: string | null
          voice_settings?: Json
          voice_style?: string | null
        }
        Update: {
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
          updated_at?: string
          user_id?: string
          voice_id?: string | null
          voice_settings?: Json
          voice_style?: string | null
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
      video_render_jobs: {
        Row: {
          clip_id: string
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          ffmpeg_cmd: string | null
          id: string
          input_url: string
          output_url: string | null
          provider: string | null
          provider_job_id: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          clip_id: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          ffmpeg_cmd?: string | null
          id?: string
          input_url: string
          output_url?: string | null
          provider?: string | null
          provider_job_id?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          clip_id?: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          ffmpeg_cmd?: string | null
          id?: string
          input_url?: string
          output_url?: string | null
          provider?: string | null
          provider_job_id?: string | null
          status?: string | null
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
          app_password: string
          created_at: string | null
          id: string
          label: string | null
          last_used_at: string | null
          project_id: string | null
          site_url: string
          user_id: string
          verified: boolean | null
          wp_username: string
        }
        Insert: {
          app_password: string
          created_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          project_id?: string | null
          site_url: string
          user_id: string
          verified?: boolean | null
          wp_username: string
        }
        Update: {
          app_password?: string
          created_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          project_id?: string | null
          site_url?: string
          user_id?: string
          verified?: boolean | null
          wp_username?: string
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
