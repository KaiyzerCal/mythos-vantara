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
      councils: {
        Row: {
          avatar: string | null
          class: string
          created_at: string
          id: string
          name: string
          notes: string
          role: string
          specialty: string | null
          updated_at: string
          user_id: string
          voice_id: string | null
          voice_settings: Json
        }
        Insert: {
          avatar?: string | null
          class?: string
          created_at?: string
          id?: string
          name: string
          notes?: string
          role?: string
          specialty?: string | null
          updated_at?: string
          user_id: string
          voice_id?: string | null
          voice_settings?: Json
        }
        Update: {
          avatar?: string | null
          class?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string
          role?: string
          specialty?: string | null
          updated_at?: string
          user_id?: string
          voice_id?: string | null
          voice_settings?: Json
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
      personas: {
        Row: {
          archetype: string
          avatar_key: string | null
          created_at: string
          embodiment_endpoint: string | null
          id: string
          is_active: boolean
          model: string
          name: string
          personality: Json
          role: string
          system_prompt: string
          updated_at: string
          user_id: string
          voice_id: string | null
          voice_settings: Json
        }
        Insert: {
          archetype: string
          avatar_key?: string | null
          created_at?: string
          embodiment_endpoint?: string | null
          id?: string
          is_active?: boolean
          model?: string
          name: string
          personality?: Json
          role: string
          system_prompt: string
          updated_at?: string
          user_id: string
          voice_id?: string | null
          voice_settings?: Json
        }
        Update: {
          archetype?: string
          avatar_key?: string | null
          created_at?: string
          embodiment_endpoint?: string | null
          id?: string
          is_active?: boolean
          model?: string
          name?: string
          personality?: Json
          role?: string
          system_prompt?: string
          updated_at?: string
          user_id?: string
          voice_id?: string | null
          voice_settings?: Json
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
          created_at: string
          deadline: string | null
          debuff_effects: Json
          description: string
          difficulty: string
          id: string
          linked_skill_ids: string[]
          loot_rewards: Json
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
          created_at?: string
          deadline?: string | null
          debuff_effects?: Json
          description?: string
          difficulty?: string
          id?: string
          linked_skill_ids?: string[]
          loot_rewards?: Json
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
          created_at?: string
          deadline?: string | null
          debuff_effects?: Json
          description?: string
          difficulty?: string
          id?: string
          linked_skill_ids?: string[]
          loot_rewards?: Json
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
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
