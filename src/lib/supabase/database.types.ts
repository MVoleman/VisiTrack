export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      app_settings: {
        Row: {
          duplicate_scan_seconds: number
          id: boolean
          kiosk_ip_allowlist: unknown[]
          presence_window_hours: number
          snapshot_retention_days: number
          time_zone: string
          updated_at: string
        }
        Insert: {
          duplicate_scan_seconds?: number
          id?: boolean
          kiosk_ip_allowlist?: unknown[]
          presence_window_hours?: number
          snapshot_retention_days?: number
          time_zone?: string
          updated_at?: string
        }
        Update: {
          duplicate_scan_seconds?: number
          id?: boolean
          kiosk_ip_allowlist?: unknown[]
          presence_window_hours?: number
          snapshot_retention_days?: number
          time_zone?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_users: {
        Row: {
          created_at: string
          display_name: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      kiosk_scan_denials: {
        Row: {
          id: string
          kiosk_ip: unknown
          kiosk_user_id: string | null
          occurred_at: string
          reason: string
        }
        Insert: {
          id?: string
          kiosk_ip?: unknown
          kiosk_user_id?: string | null
          occurred_at?: string
          reason: string
        }
        Update: {
          id?: string
          kiosk_ip?: unknown
          kiosk_user_id?: string | null
          occurred_at?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "kiosk_scan_denials_kiosk_user_id_fkey"
            columns: ["kiosk_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      time_logs: {
        Row: {
          client_captured_at: string | null
          created_at: string
          created_by: string | null
          event_type: Database["public"]["Enums"]["time_log_event"]
          id: string
          kiosk_ip: unknown
          kiosk_user_id: string | null
          note: string | null
          occurred_at: string
          snapshot_path: string | null
          snapshot_purged_at: string | null
          snapshot_uploaded_at: string | null
          source: Database["public"]["Enums"]["time_log_source"]
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          worker_id: string
        }
        Insert: {
          client_captured_at?: string | null
          created_at?: string
          created_by?: string | null
          event_type: Database["public"]["Enums"]["time_log_event"]
          id?: string
          kiosk_ip?: unknown
          kiosk_user_id?: string | null
          note?: string | null
          occurred_at?: string
          snapshot_path?: string | null
          snapshot_purged_at?: string | null
          snapshot_uploaded_at?: string | null
          source?: Database["public"]["Enums"]["time_log_source"]
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          worker_id: string
        }
        Update: {
          client_captured_at?: string | null
          created_at?: string
          created_by?: string | null
          event_type?: Database["public"]["Enums"]["time_log_event"]
          id?: string
          kiosk_ip?: unknown
          kiosk_user_id?: string | null
          note?: string | null
          occurred_at?: string
          snapshot_path?: string | null
          snapshot_purged_at?: string | null
          snapshot_uploaded_at?: string | null
          source?: Database["public"]["Enums"]["time_log_source"]
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_logs_kiosk_user_id_fkey"
            columns: ["kiosk_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "time_logs_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "current_presence"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "time_logs_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_badges: {
        Row: {
          created_at: string
          rotated_at: string
          token: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          rotated_at?: string
          token?: string
          worker_id: string
        }
        Update: {
          created_at?: string
          rotated_at?: string
          token?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_badges_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "current_presence"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_badges_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      workers: {
        Row: {
          company: string
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          role: string
          updated_at: string
        }
        Insert: {
          company: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          role: string
          updated_at?: string
        }
        Update: {
          company?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      current_presence: {
        Row: {
          checked_in_at: string | null
          company: string | null
          full_name: string | null
          role: string | null
          snapshot_path: string | null
          snapshot_purged_at: string | null
          snapshot_uploaded_at: string | null
          time_log_id: string | null
          worker_id: string | null
        }
        Relationships: []
      }
      work_sessions: {
        Row: {
          check_in_at: string | null
          check_in_log_id: string | null
          check_out_at: string | null
          check_out_log_id: string | null
          duration: string | null
          worker_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_logs_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "current_presence"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "time_logs_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      kiosk_confirm_snapshot: {
        Args: { p_time_log_id: string }
        Returns: boolean
      }
      kiosk_register_scan: {
        Args: { p_client_captured_at?: string; p_token: string }
        Returns: {
          event_type: Database["public"]["Enums"]["time_log_event"]
          occurred_at: string
          snapshot_path: string
          status: string
          time_log_id: string
          worker_company: string
          worker_name: string
        }[]
      }
      mark_snapshots_purged: {
        Args: { p_time_log_ids: string[] }
        Returns: number
      }
      rotate_worker_qr_token: { Args: { p_worker_id: string }; Returns: string }
      snapshots_due_for_purge: {
        Args: { p_limit?: number }
        Returns: {
          snapshot_path: string
          time_log_id: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "kiosk" | "viewer"
      time_log_event: "check_in" | "check_out"
      time_log_source: "kiosk" | "admin"
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
      app_role: ["admin", "kiosk", "viewer"],
      time_log_event: ["check_in", "check_out"],
      time_log_source: ["kiosk", "admin"],
    },
  },
} as const

