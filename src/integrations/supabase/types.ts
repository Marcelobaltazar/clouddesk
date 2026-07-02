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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account: {
        Row: {
          created_at: string | null
          email: string | null
          has_password: boolean | null
          has_purchase: boolean | null
          id: string
          name: string | null
          phone: string | null
          stripe_customer_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          has_password?: boolean | null
          has_purchase?: boolean | null
          id?: string
          name?: string | null
          phone?: string | null
          stripe_customer_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          has_password?: boolean | null
          has_purchase?: boolean | null
          id?: string
          name?: string | null
          phone?: string | null
          stripe_customer_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      activity_log: {
        Row: {
          action: string
          agent_id: string | null
          conversation_id: string | null
          created_at: string | null
          details: Json | null
          id: string
          org_id: string
        }
        Insert: {
          action: string
          agent_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          org_id: string
        }
        Update: {
          action?: string
          agent_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          id: string
          max_concurrent_chats: number | null
          name: string
          org_id: string
          role: string | null
          status: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          id: string
          max_concurrent_chats?: number | null
          name: string
          org_id: string
          role?: string | null
          status?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          id?: string
          max_concurrent_chats?: number | null
          name?: string
          org_id?: string
          role?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          avatar_url: string | null
          browser_info: Json | null
          created_at: string | null
          email: string | null
          first_seen_at: string | null
          id: string
          last_seen_at: string | null
          location: Json | null
          metadata: Json | null
          name: string | null
          org_id: string
          phone: string | null
        }
        Insert: {
          avatar_url?: string | null
          browser_info?: Json | null
          created_at?: string | null
          email?: string | null
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          location?: Json | null
          metadata?: Json | null
          name?: string | null
          org_id: string
          phone?: string | null
        }
        Update: {
          avatar_url?: string | null
          browser_info?: Json | null
          created_at?: string | null
          email?: string | null
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          location?: Json | null
          metadata?: Json | null
          name?: string | null
          org_id?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_tags: {
        Row: {
          conversation_id: string
          tag_id: string
        }
        Insert: {
          conversation_id: string
          tag_id: string
        }
        Update: {
          conversation_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_tags_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_agent_id: string | null
          channel: string | null
          contact_id: string
          created_at: string | null
          first_response_at: string | null
          id: string
          metadata: Json | null
          org_id: string
          priority: string | null
          resolved_at: string | null
          sla_deadline: string | null
          status: string | null
          subject: string | null
          team: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_agent_id?: string | null
          channel?: string | null
          contact_id: string
          created_at?: string | null
          first_response_at?: string | null
          id?: string
          metadata?: Json | null
          org_id: string
          priority?: string | null
          resolved_at?: string | null
          sla_deadline?: string | null
          status?: string | null
          subject?: string | null
          team?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_agent_id?: string | null
          channel?: string | null
          contact_id?: string
          created_at?: string | null
          first_response_at?: string | null
          id?: string
          metadata?: Json | null
          org_id?: string
          priority?: string | null
          resolved_at?: string | null
          sla_deadline?: string | null
          status?: string | null
          subject?: string | null
          team?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_activity_log: {
        Row: {
          action: string
          agent_id: string | null
          conversation_id: string | null
          created_at: string | null
          details: Json | null
          id: string
        }
        Insert: {
          action: string
          agent_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
        }
        Update: {
          action?: string
          agent_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "desk_activity_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "desk_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desk_activity_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "desk_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_agents: {
        Row: {
          auth_user_id: string | null
          avatar_url: string | null
          created_at: string | null
          email: string
          id: string
          max_concurrent_chats: number | null
          name: string
          notification_sound: boolean | null
          role: string | null
          status: string | null
        }
        Insert: {
          auth_user_id?: string | null
          avatar_url?: string | null
          created_at?: string | null
          email: string
          id?: string
          max_concurrent_chats?: number | null
          name: string
          notification_sound?: boolean | null
          role?: string | null
          status?: string | null
        }
        Update: {
          auth_user_id?: string | null
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          id?: string
          max_concurrent_chats?: number | null
          name?: string
          notification_sound?: boolean | null
          role?: string | null
          status?: string | null
        }
        Relationships: []
      }
      desk_ai_config: {
        Row: {
          api_key: string
          confidence_threshold: number | null
          created_at: string | null
          fallback_provider_id: string | null
          id: string
          is_active: boolean | null
          max_tokens: number | null
          model: string
          persona: Json | null
          provider: string
          settings: Json | null
          system_prompt: string | null
          temperature: number | null
        }
        Insert: {
          api_key: string
          confidence_threshold?: number | null
          created_at?: string | null
          fallback_provider_id?: string | null
          id?: string
          is_active?: boolean | null
          max_tokens?: number | null
          model: string
          persona?: Json | null
          provider: string
          settings?: Json | null
          system_prompt?: string | null
          temperature?: number | null
        }
        Update: {
          api_key?: string
          confidence_threshold?: number | null
          created_at?: string | null
          fallback_provider_id?: string | null
          id?: string
          is_active?: boolean | null
          max_tokens?: number | null
          model?: string
          persona?: Json | null
          provider?: string
          settings?: Json | null
          system_prompt?: string | null
          temperature?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "desk_ai_config_fallback_provider_id_fkey"
            columns: ["fallback_provider_id"]
            isOneToOne: false
            referencedRelation: "desk_ai_config"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_ai_interactions: {
        Row: {
          agent_feedback: string | null
          completion_tokens: number | null
          confidence: number | null
          context_sources: Json | null
          conversation_id: string | null
          created_at: string | null
          id: string
          latency_ms: number | null
          message_id: string | null
          model: string
          prompt_tokens: number | null
          provider: string
          total_tokens: number | null
          was_escalated: boolean | null
        }
        Insert: {
          agent_feedback?: string | null
          completion_tokens?: number | null
          confidence?: number | null
          context_sources?: Json | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          latency_ms?: number | null
          message_id?: string | null
          model: string
          prompt_tokens?: number | null
          provider: string
          total_tokens?: number | null
          was_escalated?: boolean | null
        }
        Update: {
          agent_feedback?: string | null
          completion_tokens?: number | null
          confidence?: number | null
          context_sources?: Json | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          latency_ms?: number | null
          message_id?: string | null
          model?: string
          prompt_tokens?: number | null
          provider?: string
          total_tokens?: number | null
          was_escalated?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "desk_ai_interactions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "desk_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desk_ai_interactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "desk_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_ai_snippets: {
        Row: {
          category: string | null
          content: string
          created_at: string | null
          embedding: string | null
          id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      desk_contact_notes: {
        Row: {
          account_user_id: string
          agent_id: string | null
          content: string
          created_at: string | null
          id: string
        }
        Insert: {
          account_user_id: string
          agent_id?: string | null
          content: string
          created_at?: string | null
          id?: string
        }
        Update: {
          account_user_id?: string
          agent_id?: string | null
          content?: string
          created_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "desk_contact_notes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "desk_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_conversation_tags: {
        Row: {
          conversation_id: string
          tag_id: string
        }
        Insert: {
          conversation_id: string
          tag_id: string
        }
        Update: {
          conversation_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "desk_conversation_tags_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "desk_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desk_conversation_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "desk_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_conversations: {
        Row: {
          account_user_id: string | null
          ai_active: boolean | null
          assigned_agent_id: string | null
          channel: string | null
          created_at: string | null
          first_response_at: string | null
          first_seen_by_agent_at: string | null
          id: string
          metadata: Json | null
          priority: string | null
          resolved_at: string | null
          sla_deadline: string | null
          snoozed_until: string | null
          status: string | null
          subject: string | null
          tags: string[] | null
          unread_count: number | null
          updated_at: string | null
          user_email: string | null
        }
        Insert: {
          account_user_id?: string | null
          ai_active?: boolean | null
          assigned_agent_id?: string | null
          channel?: string | null
          created_at?: string | null
          first_response_at?: string | null
          first_seen_by_agent_at?: string | null
          id?: string
          metadata?: Json | null
          priority?: string | null
          resolved_at?: string | null
          sla_deadline?: string | null
          snoozed_until?: string | null
          status?: string | null
          subject?: string | null
          tags?: string[] | null
          unread_count?: number | null
          updated_at?: string | null
          user_email?: string | null
        }
        Update: {
          account_user_id?: string | null
          ai_active?: boolean | null
          assigned_agent_id?: string | null
          channel?: string | null
          created_at?: string | null
          first_response_at?: string | null
          first_seen_by_agent_at?: string | null
          id?: string
          metadata?: Json | null
          priority?: string | null
          resolved_at?: string | null
          sla_deadline?: string | null
          snoozed_until?: string | null
          status?: string | null
          subject?: string | null
          tags?: string[] | null
          unread_count?: number | null
          updated_at?: string | null
          user_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "desk_conversations_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "desk_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_csat: {
        Row: {
          account_user_id: string
          comment: string | null
          conversation_id: string | null
          created_at: string | null
          id: string
          rating: number
        }
        Insert: {
          account_user_id: string
          comment?: string | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          rating: number
        }
        Update: {
          account_user_id?: string
          comment?: string | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "desk_csat_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "desk_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_faq: {
        Row: {
          answer: string
          category: string | null
          created_at: string | null
          embedding: string | null
          hit_count: number | null
          id: string
          last_asked_at: string | null
          question: string
          source: string | null
          updated_at: string | null
        }
        Insert: {
          answer: string
          category?: string | null
          created_at?: string | null
          embedding?: string | null
          hit_count?: number | null
          id?: string
          last_asked_at?: string | null
          question: string
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          answer?: string
          category?: string | null
          created_at?: string | null
          embedding?: string | null
          hit_count?: number | null
          id?: string
          last_asked_at?: string | null
          question?: string
          source?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      desk_knowledge_base: {
        Row: {
          category: string | null
          content: string
          created_at: string | null
          created_by: string | null
          embedding: string | null
          id: string
          is_published: boolean | null
          source: string | null
          source_id: string | null
          tags: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string | null
          created_by?: string | null
          embedding?: string | null
          id?: string
          is_published?: boolean | null
          source?: string | null
          source_id?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          embedding?: string | null
          id?: string
          is_published?: boolean | null
          source?: string | null
          source_id?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "desk_knowledge_base_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "desk_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_macros: {
        Row: {
          category: string | null
          content: string
          created_at: string | null
          created_by: string | null
          id: string
          is_shared: boolean | null
          name: string
          shortcut: string | null
          usage_count: number | null
          variables: Json | null
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_shared?: boolean | null
          name: string
          shortcut?: string | null
          usage_count?: number | null
          variables?: Json | null
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_shared?: boolean | null
          name?: string
          shortcut?: string | null
          usage_count?: number | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "desk_macros_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "desk_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_messages: {
        Row: {
          ai_generated: boolean | null
          attachments: Json | null
          content: string
          content_type: string | null
          conversation_id: string
          created_at: string | null
          id: string
          is_private_note: boolean | null
          metadata: Json | null
          sender_id: string | null
          sender_type: string
        }
        Insert: {
          ai_generated?: boolean | null
          attachments?: Json | null
          content: string
          content_type?: string | null
          conversation_id: string
          created_at?: string | null
          id?: string
          is_private_note?: boolean | null
          metadata?: Json | null
          sender_id?: string | null
          sender_type: string
        }
        Update: {
          ai_generated?: boolean | null
          attachments?: Json | null
          content?: string
          content_type?: string | null
          conversation_id?: string
          created_at?: string | null
          id?: string
          is_private_note?: boolean | null
          metadata?: Json | null
          sender_id?: string | null
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "desk_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "desk_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_routing_rules: {
        Row: {
          action: string | null
          category: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          keywords: string[]
          name: string
          order_priority: number | null
          priority_override: string | null
          target_agent_id: string | null
          target_team: string | null
        }
        Insert: {
          action?: string | null
          category: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          keywords: string[]
          name: string
          order_priority?: number | null
          priority_override?: string | null
          target_agent_id?: string | null
          target_team?: string | null
        }
        Update: {
          action?: string | null
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          keywords?: string[]
          name?: string
          order_priority?: number | null
          priority_override?: string | null
          target_agent_id?: string | null
          target_team?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "desk_routing_rules_target_agent_id_fkey"
            columns: ["target_agent_id"]
            isOneToOne: false
            referencedRelation: "desk_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_sla_policies: {
        Row: {
          created_at: string | null
          description: string | null
          first_response_minutes: number
          id: string
          is_active: boolean | null
          name: string
          plan: string | null
          priority: string | null
          resolution_minutes: number
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          first_response_minutes?: number
          id?: string
          is_active?: boolean | null
          name: string
          plan?: string | null
          priority?: string | null
          resolution_minutes?: number
        }
        Update: {
          created_at?: string | null
          description?: string | null
          first_response_minutes?: number
          id?: string
          is_active?: boolean | null
          name?: string
          plan?: string | null
          priority?: string | null
          resolution_minutes?: number
        }
        Relationships: []
      }
      desk_snippets: {
        Row: {
          category: string | null
          content: string
          created_at: string | null
          created_by: string | null
          embedding: string | null
          id: string
          shortcut: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string | null
          created_by?: string | null
          embedding?: string | null
          id?: string
          shortcut?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          embedding?: string | null
          id?: string
          shortcut?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      desk_tags: {
        Row: {
          color: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      desk_views: {
        Row: {
          color: string | null
          created_at: string | null
          emoji: string | null
          filters: Json | null
          id: string
          is_active: boolean | null
          name: string
          order_index: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          emoji?: string | null
          filters?: Json | null
          id?: string
          is_active?: boolean | null
          name: string
          order_index?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          emoji?: string | null
          filters?: Json | null
          id?: string
          is_active?: boolean | null
          name?: string
          order_index?: number | null
        }
        Relationships: []
      }
      guides: {
        Row: {
          created_at: string | null
          id: string
          status: string | null
          title: string
          video_path: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          status?: string | null
          title: string
          video_path?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          status?: string | null
          title?: string
          video_path?: string | null
        }
        Relationships: []
      }
      infrastructure: {
        Row: {
          id: string
          status: string | null
        }
        Insert: {
          id?: string
          status?: string | null
        }
        Update: {
          id?: string
          status?: string | null
        }
        Relationships: []
      }
      macros: {
        Row: {
          category: string | null
          content: string
          created_at: string | null
          created_by: string | null
          id: string
          is_shared: boolean | null
          name: string
          org_id: string
          shortcut: string | null
          usage_count: number | null
          variables: Json | null
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_shared?: boolean | null
          name: string
          org_id: string
          shortcut?: string | null
          usage_count?: number | null
          variables?: Json | null
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_shared?: boolean | null
          name?: string
          org_id?: string
          shortcut?: string | null
          usage_count?: number | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "macros_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "macros_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          ai_generated: boolean | null
          attachments: Json | null
          content: string
          content_type: string | null
          conversation_id: string
          created_at: string | null
          id: string
          is_private_note: boolean | null
          metadata: Json | null
          sender_id: string | null
          sender_type: string
        }
        Insert: {
          ai_generated?: boolean | null
          attachments?: Json | null
          content: string
          content_type?: string | null
          conversation_id: string
          created_at?: string | null
          id?: string
          is_private_note?: boolean | null
          metadata?: Json | null
          sender_id?: string | null
          sender_type: string
        }
        Update: {
          ai_generated?: boolean | null
          attachments?: Json | null
          content?: string
          content_type?: string | null
          conversation_id?: string
          created_at?: string | null
          id?: string
          is_private_note?: boolean | null
          metadata?: Json | null
          sender_id?: string | null
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          id: string
          name: string
          settings: Json | null
          slug: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          settings?: Json | null
          slug: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          settings?: Json | null
          slug?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          id: number
          name: string | null
        }
        Insert: {
          id: number
          name?: string | null
        }
        Update: {
          id?: number
          name?: string | null
        }
        Relationships: []
      }
      purchases: {
        Row: {
          amount: number | null
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          created_at: string | null
          currency: string | null
          current_datetime: string | null
          deployment_attempted_at: string | null
          deployment_failure_reason: string | null
          deployment_retry_count: number | null
          external_purchase_id: string | null
          id: string
          linked_infrastructure_id: string | null
          pending_deployment: boolean | null
          product_id: number | null
          purchase_code: string | null
          purchase_date: string | null
          status: string | null
          stripe_invoice_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          virtual_number_data: Json | null
        }
        Insert: {
          amount?: number | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          created_at?: string | null
          currency?: string | null
          current_datetime?: string | null
          deployment_attempted_at?: string | null
          deployment_failure_reason?: string | null
          deployment_retry_count?: number | null
          external_purchase_id?: string | null
          id?: string
          linked_infrastructure_id?: string | null
          pending_deployment?: boolean | null
          product_id?: number | null
          purchase_code?: string | null
          purchase_date?: string | null
          status?: string | null
          stripe_invoice_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          virtual_number_data?: Json | null
        }
        Update: {
          amount?: number | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          created_at?: string | null
          currency?: string | null
          current_datetime?: string | null
          deployment_attempted_at?: string | null
          deployment_failure_reason?: string | null
          deployment_retry_count?: number | null
          external_purchase_id?: string | null
          id?: string
          linked_infrastructure_id?: string | null
          pending_deployment?: boolean | null
          product_id?: number | null
          purchase_code?: string | null
          purchase_date?: string | null
          status?: string | null
          stripe_invoice_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          virtual_number_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_linked_infrastructure_id_fkey"
            columns: ["linked_infrastructure_id"]
            isOneToOne: false
            referencedRelation: "infrastructure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      steps: {
        Row: {
          audio_path: string | null
          created_at: string | null
          guide_id: string | null
          id: string
          image_path: string | null
          narration_text: string | null
          order_index: number
        }
        Insert: {
          audio_path?: string | null
          created_at?: string | null
          guide_id?: string | null
          id?: string
          image_path?: string | null
          narration_text?: string | null
          order_index: number
        }
        Update: {
          audio_path?: string | null
          created_at?: string | null
          guide_id?: string | null
          id?: string
          image_path?: string | null
          narration_text?: string | null
          order_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "steps_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          id: string
          name: string
          org_id: string
        }
        Insert: {
          color?: string | null
          id?: string
          name: string
          org_id: string
        }
        Update: {
          color?: string | null
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_agent_org_id: { Args: never; Returns: string }
      is_desk_admin: { Args: never; Returns: boolean }
      is_desk_agent: { Args: never; Returns: boolean }
      match_ai_snippets: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          category: string
          content: string
          id: string
          similarity: number
          title: string
        }[]
      }
      match_faq: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          answer: string
          id: string
          question: string
          similarity: number
        }[]
      }
      match_knowledge_base: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          category: string
          content: string
          id: string
          similarity: number
          source: string
          source_id: string
          title: string
        }[]
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
