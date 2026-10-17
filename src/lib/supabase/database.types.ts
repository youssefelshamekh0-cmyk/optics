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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      branch_lens_prices: {
        Row: {
          active: boolean
          branch_id: string
          cost_price: number
          created_at: string
          cylinder_max: number | null
          cylinder_min: number | null
          id: string
          lens_type_id: string
          options: string
          reference_price: number
          sphere_max: number
          sphere_min: number
        }
        Insert: {
          active?: boolean
          branch_id: string
          cost_price?: number
          created_at?: string
          cylinder_max?: number | null
          cylinder_min?: number | null
          id?: string
          lens_type_id: string
          options?: string
          reference_price: number
          sphere_max: number
          sphere_min: number
        }
        Update: {
          active?: boolean
          branch_id?: string
          cost_price?: number
          created_at?: string
          cylinder_max?: number | null
          cylinder_min?: number | null
          id?: string
          lens_type_id?: string
          options?: string
          reference_price?: number
          sphere_max?: number
          sphere_min?: number
        }
        Relationships: [
          {
            foreignKeyName: "branch_lens_prices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_lens_prices_lens_type_id_fkey"
            columns: ["lens_type_id"]
            isOneToOne: false
            referencedRelation: "lens_types"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_products: {
        Row: {
          branch_id: string
          cost_price: number
          id: string
          product_id: string
          quantity: number
          low_stock_threshold: number
          reference_price: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          cost_price?: number
          id?: string
          product_id: string
          quantity?: number
          low_stock_threshold?: number
          reference_price?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          cost_price?: number
          id?: string
          product_id?: string
          quantity?: number
          low_stock_threshold?: number
          reference_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_products_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          code: string
          created_at: string
          id: string
          name: string
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          code: string
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      lens_companies: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      lens_supplies: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          id: string
          invoice_number: string
          received_at: string
          status: string
          supplier_id: string
          total_cost: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_number: string
          received_at?: string
          status?: string
          supplier_id: string
          total_cost: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_number?: string
          received_at?: string
          status?: string
          supplier_id?: string
          total_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "lens_supplies_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lens_supplies_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      lens_supply_items: {
        Row: {
          id: string
          line_total: number | null
          product_id: string
          quantity: number
          supply_id: string
          unit_cost: number
        }
        Insert: {
          id?: string
          line_total?: number | null
          product_id: string
          quantity: number
          supply_id: string
          unit_cost: number
        }
        Update: {
          id?: string
          line_total?: number | null
          product_id?: string
          quantity?: number
          supply_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "lens_supply_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lens_supply_items_supply_id_fkey"
            columns: ["supply_id"]
            isOneToOne: false
            referencedRelation: "lens_supplies"
            referencedColumns: ["id"]
          },
        ]
      }
      lens_types: {
        Row: {
          active: boolean
          category: string
          company_id: string
          created_at: string
          id: string
          name: string
          specifications: Json
        }
        Insert: {
          active?: boolean
          category?: string
          company_id: string
          created_at?: string
          id?: string
          name: string
          specifications?: Json
        }
        Update: {
          active?: boolean
          category?: string
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          specifications?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lens_types_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "lens_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          description: string
          id: string
          key: string
        }
        Insert: {
          description: string
          id?: string
          key: string
        }
        Update: {
          description?: string
          id?: string
          key?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          brand: string | null
          category: string
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          model: string | null
          name: string
          size: string | null
          sku: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          brand?: string | null
          category: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          model?: string | null
          name: string
          size?: string | null
          sku?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          brand?: string | null
          category?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          model?: string | null
          name?: string
          size?: string | null
          sku?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          id: string
          key: string
          name: string
        }
        Insert: {
          id?: string
          key: string
          name: string
        }
        Update: {
          id?: string
          key?: string
          name?: string
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          id: string
          item_kind: string
          item_name: string
          line_total: number | null
          product_id: string | null
          quantity: number
          sale_id: string
          technical_details: Json
          unit_price: number
        }
        Insert: {
          id?: string
          item_kind?: string
          item_name: string
          line_total?: number | null
          product_id?: string | null
          quantity: number
          sale_id: string
          technical_details?: Json
          unit_price: number
        }
        Update: {
          id?: string
          item_kind?: string
          item_name?: string
          line_total?: number | null
          product_id?: string | null
          quantity?: number
          sale_id?: string
          technical_details?: Json
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          notes: string | null
          payment_method: string
          received_by: string | null
          sale_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          notes?: string | null
          payment_method: string
          received_by?: string | null
          sale_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          payment_method?: string
          received_by?: string | null
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          delivery_status: string
          discount_amount: number
          grand_total: number | null
          id: string
          invoice_number: number
          notes: string | null
          prescription: Json
          reference_total: number
          sale_type: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          delivery_status?: string
          discount_amount?: number
          grand_total?: number | null
          id?: string
          invoice_number?: number
          notes?: string | null
          prescription?: Json
          reference_total?: number
          sale_type?: string
          total_amount: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delivery_status?: string
          discount_amount?: number
          grand_total?: number | null
          id?: string
          invoice_number?: number
          notes?: string | null
          prescription?: Json
          reference_total?: number
          sale_type?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          id: string
          movement_type: string
          product_id: string
          quantity_delta: number
          reason: string | null
          reference_id: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type: string
          product_id: string
          quantity_delta: number
          reason?: string | null
          reference_id?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type?: string
          product_id?: string
          quantity_delta?: number
          reason?: string | null
          reference_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean
          address: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      user_branch_access: {
        Row: {
          branch_id: string
          user_id: string
        }
        Insert: {
          branch_id: string
          user_id: string
        }
        Update: {
          branch_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_branch_access_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branch_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          permission_id: string
          user_id: string
        }
        Insert: {
          permission_id: string
          user_id: string
        }
        Update: {
          permission_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          role_id: string
          user_id: string
        }
        Insert: {
          role_id: string
          user_id: string
        }
        Update: {
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_create_phone_profile: {
        Args: {
          p_branch_ids?: string[]
          p_full_name: string
          p_permission_keys?: string[]
          p_phone: string
          p_role_key: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_create_user_profile: {
        Args: {
          p_branch_ids?: string[]
          p_email: string
          p_full_name: string
          p_permission_keys?: string[]
          p_role_key: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_update_salesperson: {
        Args: {
          p_branch_ids: string[]
          p_full_name: string
          p_permission_keys: string[]
          p_status: string
          p_user_id: string
        }
        Returns: undefined
      }
      create_optics_product: {
        Args: {
          p_branch_id: string
          p_brand: string
          p_category: string
          p_color: string
          p_cost_price: number
          p_created_by: string
          p_model: string
          p_name: string
          p_quantity: number
          p_reference_price: number
          p_size: string
          p_sku: string
        }
        Returns: string
      }
      create_optics_sale: {
        Args: {
          p_branch_id: string
          p_created_by: string
          p_customer_id: string
          p_final_total: number
          p_initial_payment: number
          p_items: Json
          p_notes: string
          p_payment_method: string
          p_prescription: Json
          p_sale_type: string
        }
        Returns: {
          invoice_number: number
          sale_id: string
        }[]
      }
      receive_lens_supply: {
        Args: {
          p_branch_id: string
          p_created_by: string
          p_invoice_number: string
          p_items: Json
          p_received_at: string
          p_supplier_name: string
          p_supplier_phone: string
        }
        Returns: string
      }
      process_sale_return: {
        Args: {
          p_actor: string
          p_cash_account_id: string
          p_idempotency_key: string
          p_items: Json
          p_reason: string
          p_sale_id: string
        }
        Returns: {
          refund_amount: number
          return_id: string
        }[]
      }
      record_sale_payment: {
        Args: {
          p_amount: number
          p_notes: string
          p_payment_method: string
          p_received_by: string
          p_sale_id: string
        }
        Returns: string
      },
      create_customer_idempotent: {
        Args: {
          p_operation_id: string
          p_actor_id: string
          p_full_name: string
          p_phone: string
          p_email: string
          p_notes: string
        }
        Returns: Json
      },
      create_optics_sale_idempotent: {
        Args: {
          p_operation_id: string
          p_actor_id: string
          p_branch_id: string
          p_customer_id: string
          p_sale_type: string
          p_items: Json
          p_prescription: Json
          p_final_total: number
          p_initial_payment: number
          p_payment_method: string
          p_notes: string
        }
        Returns: Json
      },
      record_sale_payment_idempotent: {
        Args: {
          p_sale_id: string
          p_amount: number
          p_payment_method: string
          p_received_by: string
          p_notes: string
          p_operation_id: string
        }
        Returns: string
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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

