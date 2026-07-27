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
  public: {
    Tables: {
      _qhash_migrations: {
        Row: {
          applied_at: string
          checksum: string
          commit_ref: string | null
          deploy_context: string | null
          id: string
        }
        Insert: {
          applied_at?: string
          checksum: string
          commit_ref?: string | null
          deploy_context?: string | null
          id: string
        }
        Update: {
          applied_at?: string
          checksum?: string
          commit_ref?: string | null
          deploy_context?: string | null
          id?: string
        }
        Relationships: []
      }
      admin_security_reset_audit: {
        Row: {
          action: string
          admin_user_id: string
          created_at: string
          id: string
          metadata: Json
          old_had_fund_password: boolean | null
          reason: string
          target_user_id: string
        }
        Insert: {
          action: string
          admin_user_id: string
          created_at?: string
          id?: string
          metadata?: Json
          old_had_fund_password?: boolean | null
          reason: string
          target_user_id: string
        }
        Update: {
          action?: string
          admin_user_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          old_had_fund_password?: boolean | null
          reason?: string
          target_user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      crypto_deposit_addresses: {
        Row: {
          activation_status: string
          address: string
          asset: string
          created_at: string
          derivation_index: number | null
          id: string
          network: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activation_status?: string
          address: string
          asset?: string
          created_at?: string
          derivation_index?: number | null
          id?: string
          network: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activation_status?: string
          address?: string
          asset?: string
          created_at?: string
          derivation_index?: number | null
          id?: string
          network?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crypto_deposit_addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crypto_deposits: {
        Row: {
          address_id: string | null
          amount_raw: number
          amount_usdt: number
          asset: string
          block_number: number
          confirmations: number
          confirmed_at: string | null
          created_at: string
          credited_amount_etb: number | null
          credited_at: string | null
          credited_by_admin_id: string | null
          credited_transaction_id: string | null
          detected_at: string
          event_index: number
          exchange_rate_etb: number | null
          from_address: string
          id: string
          network: string
          status: string
          swept_at: string | null
          to_address: string
          tx_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address_id?: string | null
          amount_raw: number
          amount_usdt: number
          asset?: string
          block_number: number
          confirmations?: number
          confirmed_at?: string | null
          created_at?: string
          credited_amount_etb?: number | null
          credited_at?: string | null
          credited_by_admin_id?: string | null
          credited_transaction_id?: string | null
          detected_at?: string
          event_index?: number
          exchange_rate_etb?: number | null
          from_address: string
          id?: string
          network: string
          status?: string
          swept_at?: string | null
          to_address: string
          tx_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address_id?: string | null
          amount_raw?: number
          amount_usdt?: number
          asset?: string
          block_number?: number
          confirmations?: number
          confirmed_at?: string | null
          created_at?: string
          credited_amount_etb?: number | null
          credited_at?: string | null
          credited_by_admin_id?: string | null
          credited_transaction_id?: string | null
          detected_at?: string
          event_index?: number
          exchange_rate_etb?: number | null
          from_address?: string
          id?: string
          network?: string
          status?: string
          swept_at?: string | null
          to_address?: string
          tx_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crypto_deposits_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "crypto_deposit_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crypto_deposits_credited_by_admin_id_fkey"
            columns: ["credited_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crypto_deposits_credited_transaction_id_fkey"
            columns: ["credited_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crypto_deposits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deposit_verification_logs: {
        Row: {
          action: string | null
          actor_id: string | null
          actor_type: string
          age_minutes: number | null
          amount: number | null
          created_at: string
          deposit_id: string | null
          event: string
          freshness_decision: string | null
          id: string
          metadata: Json
          payment_type:
            | Database["public"]["Enums"]["payment_method_type"]
            | null
          reason_code: string | null
          reason_message_safe: string | null
          receiver_matched: boolean | null
          source: string
          tx_ref_last4: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          actor_id?: string | null
          actor_type?: string
          age_minutes?: number | null
          amount?: number | null
          created_at?: string
          deposit_id?: string | null
          event: string
          freshness_decision?: string | null
          id?: string
          metadata?: Json
          payment_type?:
            | Database["public"]["Enums"]["payment_method_type"]
            | null
          reason_code?: string | null
          reason_message_safe?: string | null
          receiver_matched?: boolean | null
          source?: string
          tx_ref_last4?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          actor_id?: string | null
          actor_type?: string
          age_minutes?: number | null
          amount?: number | null
          created_at?: string
          deposit_id?: string | null
          event?: string
          freshness_decision?: string | null
          id?: string
          metadata?: Json
          payment_type?:
            | Database["public"]["Enums"]["payment_method_type"]
            | null
          reason_code?: string | null
          reason_message_safe?: string | null
          receiver_matched?: boolean | null
          source?: string
          tx_ref_last4?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deposit_verification_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_verification_logs_deposit_id_fkey"
            columns: ["deposit_id"]
            isOneToOne: false
            referencedRelation: "deposits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_verification_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deposits: {
        Row: {
          admin_note: string | null
          amount: number
          auto_verified: boolean | null
          created_at: string
          id: string
          payment_method_id: string
          receipt_url: string | null
          reviewed_at: string | null
          status: Database["public"]["Enums"]["deposit_status"]
          transaction_reference: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          admin_note?: string | null
          amount: number
          auto_verified?: boolean | null
          created_at?: string
          id?: string
          payment_method_id: string
          receipt_url?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["deposit_status"]
          transaction_reference: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          admin_note?: string | null
          amount?: number
          auto_verified?: boolean | null
          created_at?: string
          id?: string
          payment_method_id?: string
          receipt_url?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["deposit_status"]
          transaction_reference?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deposits_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      earning_run_logs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_details: Json | null
          error_message: string | null
          finished_at: string | null
          id: string
          metadata: Json | null
          processed_investments: number | null
          processed_users: number | null
          run_id: string | null
          run_type: string
          started_at: string | null
          status: string
          total_active_investments: number | null
          total_completed_investments: number | null
          total_earnings: number | null
          total_earnings_credited: number | null
          total_errors: number | null
          total_investments_processed: number | null
          total_skipped: number | null
          total_transactions_created: number | null
          total_users_processed: number | null
          trigger_type: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json | null
          processed_investments?: number | null
          processed_users?: number | null
          run_id?: string | null
          run_type?: string
          started_at?: string | null
          status?: string
          total_active_investments?: number | null
          total_completed_investments?: number | null
          total_earnings?: number | null
          total_earnings_credited?: number | null
          total_errors?: number | null
          total_investments_processed?: number | null
          total_skipped?: number | null
          total_transactions_created?: number | null
          total_users_processed?: number | null
          trigger_type?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json | null
          processed_investments?: number | null
          processed_users?: number | null
          run_id?: string | null
          run_type?: string
          started_at?: string | null
          status?: string
          total_active_investments?: number | null
          total_completed_investments?: number | null
          total_earnings?: number | null
          total_earnings_credited?: number | null
          total_errors?: number | null
          total_investments_processed?: number | null
          total_skipped?: number | null
          total_transactions_created?: number | null
          total_users_processed?: number | null
          trigger_type?: string | null
        }
        Relationships: []
      }
      investments: {
        Row: {
          completed_at: string | null
          created_at: string
          daily_earning: number
          end_date: string
          ends_at: string | null
          id: string
          invested_amount: number
          last_earning_at: string | null
          next_earning_at: string | null
          plan_id: string
          start_date: string
          status: Database["public"]["Enums"]["investment_status"]
          total_earned: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          daily_earning: number
          end_date: string
          ends_at?: string | null
          id?: string
          invested_amount: number
          last_earning_at?: string | null
          next_earning_at?: string | null
          plan_id: string
          start_date?: string
          status?: Database["public"]["Enums"]["investment_status"]
          total_earned?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          daily_earning?: number
          end_date?: string
          ends_at?: string | null
          id?: string
          invested_amount?: number
          last_earning_at?: string | null
          next_earning_at?: string | null
          plan_id?: string
          start_date?: string
          status?: Database["public"]["Enums"]["investment_status"]
          total_earned?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          metadata: Json | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          metadata?: Json | null
          title: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          metadata?: Json | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      nowpayments_usdt_config: {
        Row: {
          asset: string
          created_at: string
          deposit_minimum_usdt: number
          enabled: boolean
          id: string
          network: string
          provider_currency: string
          updated_at: string
          withdrawal_fee_percent: number
          withdrawal_minimum_usdt: number
          withdrawals_enabled: boolean
        }
        Insert: {
          asset?: string
          created_at?: string
          deposit_minimum_usdt?: number
          enabled?: boolean
          id?: string
          network?: string
          provider_currency?: string
          updated_at?: string
          withdrawal_fee_percent?: number
          withdrawal_minimum_usdt?: number
          withdrawals_enabled?: boolean
        }
        Update: {
          asset?: string
          created_at?: string
          deposit_minimum_usdt?: number
          enabled?: boolean
          id?: string
          network?: string
          provider_currency?: string
          updated_at?: string
          withdrawal_fee_percent?: number
          withdrawal_minimum_usdt?: number
          withdrawals_enabled?: boolean
        }
        Relationships: []
      }
      nowpayments_usdt_ledger_entries: {
        Row: {
          asset: string
          available_after_usdt: number
          available_before_usdt: number
          available_delta_usdt: number
          created_at: string
          description: string | null
          entry_type: string
          id: string
          metadata: Json
          payment_id: string | null
          provider_payment_record_id: string | null
          reserved_after_usdt: number
          reserved_before_usdt: number
          reserved_delta_usdt: number
          user_id: string
          withdrawal_id: string | null
        }
        Insert: {
          asset?: string
          available_after_usdt: number
          available_before_usdt: number
          available_delta_usdt?: number
          created_at?: string
          description?: string | null
          entry_type: string
          id?: string
          metadata?: Json
          payment_id?: string | null
          provider_payment_record_id?: string | null
          reserved_after_usdt: number
          reserved_before_usdt: number
          reserved_delta_usdt?: number
          user_id: string
          withdrawal_id?: string | null
        }
        Update: {
          asset?: string
          available_after_usdt?: number
          available_before_usdt?: number
          available_delta_usdt?: number
          created_at?: string
          description?: string | null
          entry_type?: string
          id?: string
          metadata?: Json
          payment_id?: string | null
          provider_payment_record_id?: string | null
          reserved_after_usdt?: number
          reserved_before_usdt?: number
          reserved_delta_usdt?: number
          user_id?: string
          withdrawal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nowpayments_usdt_ledger_entries_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "nowpayments_usdt_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nowpayments_usdt_ledger_entries_provider_payment_record_id_fkey"
            columns: ["provider_payment_record_id"]
            isOneToOne: false
            referencedRelation: "nowpayments_usdt_provider_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nowpayments_usdt_ledger_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nowpayments_usdt_ledger_entries_withdrawal_id_fkey"
            columns: ["withdrawal_id"]
            isOneToOne: false
            referencedRelation: "nowpayments_usdt_withdrawals"
            referencedColumns: ["id"]
          },
        ]
      }
      nowpayments_usdt_payments: {
        Row: {
          address_activated_at: string | null
          asset: string
          created_at: string
          credited_amount_usdt: number | null
          credited_at: string | null
          id: string
          manual_recovery_at: string | null
          manual_recovery_reason: string | null
          network: string
          outcome_amount: number | null
          outcome_currency: string
          pay_address: string | null
          provider_created_at: string | null
          provider_currency: string
          provider_minimum_usdt: number | null
          provider_payment_id: string | null
          provider_payment_status: string | null
          provider_valid_until: string | null
          provisioned_at: string | null
          provisioning_started_at: string
          qhash_order_id: string
          session_status: string
          settled_by_provider_payment_id: string | null
          technical_reference_amount_usdt: number | null
          terminal_at: string | null
          terminal_reason: string | null
          updated_at: string
          user_id: string
          verification_status: string
          verified_at: string | null
        }
        Insert: {
          address_activated_at?: string | null
          asset?: string
          created_at?: string
          credited_amount_usdt?: number | null
          credited_at?: string | null
          id?: string
          manual_recovery_at?: string | null
          manual_recovery_reason?: string | null
          network?: string
          outcome_amount?: number | null
          outcome_currency?: string
          pay_address?: string | null
          provider_created_at?: string | null
          provider_currency?: string
          provider_minimum_usdt?: number | null
          provider_payment_id?: string | null
          provider_payment_status?: string | null
          provider_valid_until?: string | null
          provisioned_at?: string | null
          provisioning_started_at?: string
          qhash_order_id?: string
          session_status?: string
          settled_by_provider_payment_id?: string | null
          technical_reference_amount_usdt?: number | null
          terminal_at?: string | null
          terminal_reason?: string | null
          updated_at?: string
          user_id: string
          verification_status?: string
          verified_at?: string | null
        }
        Update: {
          address_activated_at?: string | null
          asset?: string
          created_at?: string
          credited_amount_usdt?: number | null
          credited_at?: string | null
          id?: string
          manual_recovery_at?: string | null
          manual_recovery_reason?: string | null
          network?: string
          outcome_amount?: number | null
          outcome_currency?: string
          pay_address?: string | null
          provider_created_at?: string | null
          provider_currency?: string
          provider_minimum_usdt?: number | null
          provider_payment_id?: string | null
          provider_payment_status?: string | null
          provider_valid_until?: string | null
          provisioned_at?: string | null
          provisioning_started_at?: string
          qhash_order_id?: string
          session_status?: string
          settled_by_provider_payment_id?: string | null
          technical_reference_amount_usdt?: number | null
          terminal_at?: string | null
          terminal_reason?: string | null
          updated_at?: string
          user_id?: string
          verification_status?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nowpayments_usdt_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      nowpayments_usdt_provider_payments: {
        Row: {
          actually_paid_usdt: number | null
          created_at: string
          credited_amount_usdt: number | null
          credited_at: string | null
          id: string
          outcome_amount_usdt: number | null
          outcome_currency: string | null
          parent_provider_payment_id: string | null
          pay_address: string
          pay_currency: string
          payment_kind: string
          provider_payment_id: string
          provider_payment_status: string
          provider_verified_at: string
          qhash_order_id: string
          session_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          actually_paid_usdt?: number | null
          created_at?: string
          credited_amount_usdt?: number | null
          credited_at?: string | null
          id?: string
          outcome_amount_usdt?: number | null
          outcome_currency?: string | null
          parent_provider_payment_id?: string | null
          pay_address: string
          pay_currency: string
          payment_kind: string
          provider_payment_id: string
          provider_payment_status: string
          provider_verified_at?: string
          qhash_order_id: string
          session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          actually_paid_usdt?: number | null
          created_at?: string
          credited_amount_usdt?: number | null
          credited_at?: string | null
          id?: string
          outcome_amount_usdt?: number | null
          outcome_currency?: string | null
          parent_provider_payment_id?: string | null
          pay_address?: string
          pay_currency?: string
          payment_kind?: string
          provider_payment_id?: string
          provider_payment_status?: string
          provider_verified_at?: string
          qhash_order_id?: string
          session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nowpayments_usdt_provider_payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "nowpayments_usdt_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nowpayments_usdt_provider_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      nowpayments_usdt_wallets: {
        Row: {
          asset: string
          available_balance_usdt: number
          created_at: string
          reserved_balance_usdt: number
          updated_at: string
          user_id: string
        }
        Insert: {
          asset?: string
          available_balance_usdt?: number
          created_at?: string
          reserved_balance_usdt?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          asset?: string
          available_balance_usdt?: number
          created_at?: string
          reserved_balance_usdt?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nowpayments_usdt_wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      nowpayments_usdt_withdrawal_broadcasts: {
        Row: {
          correction_reason: string | null
          destination_address: string
          id: string
          net_amount_usdt: number
          recorded_at: string
          recorded_by: string
          supersedes_broadcast_id: string | null
          transaction_hash: string
          withdrawal_id: string
        }
        Insert: {
          correction_reason?: string | null
          destination_address: string
          id?: string
          net_amount_usdt: number
          recorded_at?: string
          recorded_by: string
          supersedes_broadcast_id?: string | null
          transaction_hash: string
          withdrawal_id: string
        }
        Update: {
          correction_reason?: string | null
          destination_address?: string
          id?: string
          net_amount_usdt?: number
          recorded_at?: string
          recorded_by?: string
          supersedes_broadcast_id?: string | null
          transaction_hash?: string
          withdrawal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nowpayments_usdt_withdrawal_broadc_supersedes_broadcast_id_fkey"
            columns: ["supersedes_broadcast_id"]
            isOneToOne: true
            referencedRelation: "nowpayments_usdt_withdrawal_broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nowpayments_usdt_withdrawal_broadcasts_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nowpayments_usdt_withdrawal_broadcasts_withdrawal_id_fkey"
            columns: ["withdrawal_id"]
            isOneToOne: false
            referencedRelation: "nowpayments_usdt_withdrawals"
            referencedColumns: ["id"]
          },
        ]
      }
      nowpayments_usdt_withdrawal_events: {
        Row: {
          action_id: string
          action_type: string
          actor_id: string
          canonical_payload: string
          created_at: string
          from_status: string | null
          id: string
          result_snapshot: Json
          to_status: string
          user_id: string
          withdrawal_id: string
        }
        Insert: {
          action_id: string
          action_type: string
          actor_id: string
          canonical_payload: string
          created_at?: string
          from_status?: string | null
          id?: string
          result_snapshot: Json
          to_status: string
          user_id: string
          withdrawal_id: string
        }
        Update: {
          action_id?: string
          action_type?: string
          actor_id?: string
          canonical_payload?: string
          created_at?: string
          from_status?: string | null
          id?: string
          result_snapshot?: Json
          to_status?: string
          user_id?: string
          withdrawal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nowpayments_usdt_withdrawal_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nowpayments_usdt_withdrawal_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nowpayments_usdt_withdrawal_events_withdrawal_id_fkey"
            columns: ["withdrawal_id"]
            isOneToOne: false
            referencedRelation: "nowpayments_usdt_withdrawals"
            referencedColumns: ["id"]
          },
        ]
      }
      nowpayments_usdt_withdrawal_verifications: {
        Row: {
          block_number: number
          broadcast_id: string
          chain_id: number
          confirmations: number
          created_at: string
          destination_address: string
          exactly_one_matching_transfer: boolean
          id: string
          net_amount_usdt: number
          token_contract: string
          transaction_success: boolean
          transfer_log_index: number
          verified_at: string
          verified_by: string
          withdrawal_id: string
        }
        Insert: {
          block_number: number
          broadcast_id: string
          chain_id: number
          confirmations: number
          created_at?: string
          destination_address: string
          exactly_one_matching_transfer: boolean
          id?: string
          net_amount_usdt: number
          token_contract: string
          transaction_success: boolean
          transfer_log_index: number
          verified_at: string
          verified_by: string
          withdrawal_id: string
        }
        Update: {
          block_number?: number
          broadcast_id?: string
          chain_id?: number
          confirmations?: number
          created_at?: string
          destination_address?: string
          exactly_one_matching_transfer?: boolean
          id?: string
          net_amount_usdt?: number
          token_contract?: string
          transaction_success?: boolean
          transfer_log_index?: number
          verified_at?: string
          verified_by?: string
          withdrawal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nowpayments_usdt_withdrawal_verifications_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: true
            referencedRelation: "nowpayments_usdt_withdrawal_broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nowpayments_usdt_withdrawal_verifications_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nowpayments_usdt_withdrawal_verifications_withdrawal_id_fkey"
            columns: ["withdrawal_id"]
            isOneToOne: true
            referencedRelation: "nowpayments_usdt_withdrawals"
            referencedColumns: ["id"]
          },
        ]
      }
      nowpayments_usdt_withdrawals: {
        Row: {
          asset: string
          broadcasted_at: string | null
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          current_admin_id: string | null
          current_broadcast_id: string | null
          destination_address: string
          fee_amount_usdt: number | null
          fee_percent: number
          gross_amount_usdt: number
          id: string
          initial_admin_id: string | null
          net_amount_usdt: number | null
          network: string
          provider_currency: string
          rejected_at: string | null
          rejection_reason: string | null
          requested_at: string
          send_locked_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset?: string
          broadcasted_at?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          current_admin_id?: string | null
          current_broadcast_id?: string | null
          destination_address: string
          fee_amount_usdt?: number | null
          fee_percent?: number
          gross_amount_usdt: number
          id?: string
          initial_admin_id?: string | null
          net_amount_usdt?: number | null
          network?: string
          provider_currency?: string
          rejected_at?: string | null
          rejection_reason?: string | null
          requested_at?: string
          send_locked_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset?: string
          broadcasted_at?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          current_admin_id?: string | null
          current_broadcast_id?: string | null
          destination_address?: string
          fee_amount_usdt?: number | null
          fee_percent?: number
          gross_amount_usdt?: number
          id?: string
          initial_admin_id?: string | null
          net_amount_usdt?: number | null
          network?: string
          provider_currency?: string
          rejected_at?: string | null
          rejection_reason?: string | null
          requested_at?: string
          send_locked_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nowpayments_usdt_withdrawals_current_admin_id_fkey"
            columns: ["current_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nowpayments_usdt_withdrawals_current_broadcast_fkey"
            columns: ["current_broadcast_id"]
            isOneToOne: false
            referencedRelation: "nowpayments_usdt_withdrawal_broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nowpayments_usdt_withdrawals_initial_admin_id_fkey"
            columns: ["initial_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nowpayments_usdt_withdrawals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          account_last_8: string | null
          account_name: string
          account_number: string
          created_at: string
          id: string
          instructions: string | null
          is_active: boolean
          is_archived: boolean
          type: Database["public"]["Enums"]["payment_method_type"]
          updated_at: string
        }
        Insert: {
          account_last_8?: string | null
          account_name: string
          account_number: string
          created_at?: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          is_archived?: boolean
          type: Database["public"]["Enums"]["payment_method_type"]
          updated_at?: string
        }
        Update: {
          account_last_8?: string | null
          account_name?: string
          account_number?: string
          created_at?: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          is_archived?: boolean
          type?: Database["public"]["Enums"]["payment_method_type"]
          updated_at?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          created_at: string
          daily_earning: number
          display_order: number
          duration_days: number
          icon_key: string | null
          id: string
          investment_amount: number
          is_active: boolean
          is_popular: boolean
          max_active_per_user: number
          name: string
          required_active_level1_referrals: number
          required_active_level2_referrals: number
          required_active_level3_referrals: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_earning: number
          display_order?: number
          duration_days: number
          icon_key?: string | null
          id?: string
          investment_amount: number
          is_active?: boolean
          is_popular?: boolean
          max_active_per_user?: number
          name: string
          required_active_level1_referrals?: number
          required_active_level2_referrals?: number
          required_active_level3_referrals?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_earning?: number
          display_order?: number
          duration_days?: number
          icon_key?: string | null
          id?: string
          investment_amount?: number
          is_active?: boolean
          is_popular?: boolean
          max_active_per_user?: number
          name?: string
          required_active_level1_referrals?: number
          required_active_level2_referrals?: number
          required_active_level3_referrals?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          is_admin: boolean
          is_frozen: boolean
          phone: string
          referred_by: string | null
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          id: string
          is_admin?: boolean
          is_frozen?: boolean
          phone: string
          referred_by?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          is_admin?: boolean
          is_frozen?: boolean
          phone?: string
          referred_by?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_reward_logs: {
        Row: {
          created_at: string | null
          earner_user_id: string | null
          earning_reference_id: string | null
          id: string
          investment_id: string | null
          level: number
          purchaser_user_id: string | null
          referred_user_id: string
          referrer_user_id: string
          reward_amount: number
          reward_type: string
        }
        Insert: {
          created_at?: string | null
          earner_user_id?: string | null
          earning_reference_id?: string | null
          id?: string
          investment_id?: string | null
          level: number
          purchaser_user_id?: string | null
          referred_user_id: string
          referrer_user_id: string
          reward_amount?: number
          reward_type: string
        }
        Update: {
          created_at?: string | null
          earner_user_id?: string | null
          earning_reference_id?: string | null
          id?: string
          investment_id?: string | null
          level?: number
          purchaser_user_id?: string | null
          referred_user_id?: string
          referrer_user_id?: string
          reward_amount?: number
          reward_type?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          level: number
          referred_user_id: string
          referrer_id: string
          total_investment_rewards: number
          total_mining_rewards: number
        }
        Insert: {
          created_at?: string
          id?: string
          level: number
          referred_user_id: string
          referrer_id: string
          total_investment_rewards?: number
          total_mining_rewards?: number
        }
        Update: {
          created_at?: string
          id?: string
          level?: number
          referred_user_id?: string
          referrer_id?: string
          total_investment_rewards?: number
          total_mining_rewards?: number
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          balance_after: number | null
          balance_before: number | null
          created_at: string
          description: string | null
          id: string
          metadata: Json
          reference_id: string | null
          status: Database["public"]["Enums"]["transaction_status"]
          type: Database["public"]["Enums"]["transaction_type"]
          user_id: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          balance_before?: number | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          reference_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          type: Database["public"]["Enums"]["transaction_type"]
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          balance_before?: number | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          reference_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          type?: Database["public"]["Enums"]["transaction_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_security_settings: {
        Row: {
          created_at: string
          fund_password_failed_attempts: number
          fund_password_hash: string
          fund_password_locked_until: string | null
          fund_password_set_at: string
          fund_password_updated_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fund_password_failed_attempts?: number
          fund_password_hash: string
          fund_password_locked_until?: string | null
          fund_password_set_at?: string
          fund_password_updated_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          fund_password_failed_attempts?: number
          fund_password_hash?: string
          fund_password_locked_until?: string | null
          fund_password_set_at?: string
          fund_password_updated_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawals: {
        Row: {
          account_name: string
          account_number: string
          admin_note: string | null
          amount: number
          created_at: string
          fee_amount: number
          fee_percent: number
          id: string
          method: Database["public"]["Enums"]["payment_method_type"]
          net_amount: number
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["withdrawal_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_name: string
          account_number: string
          admin_note?: string | null
          amount: number
          created_at?: string
          fee_amount?: number
          fee_percent?: number
          id?: string
          method: Database["public"]["Enums"]["payment_method_type"]
          net_amount?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_name?: string
          account_number?: string
          admin_note?: string | null
          amount?: number
          created_at?: string
          fee_amount?: number
          fee_percent?: number
          id?: string
          method?: Database["public"]["Enums"]["payment_method_type"]
          net_amount?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_user_id_fkey"
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
      approve_deposit_tx: {
        Args: {
          p_action: string
          p_admin_id: string
          p_admin_note?: string
          p_amount?: number
          p_deposit_id: string
        }
        Returns: Json
      }
      approve_withdrawal_tx: {
        Args: {
          p_admin_id: string
          p_admin_note?: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      assert_safe_nowpayments_usdt_withdrawal_destination: {
        Args: { p_value: string }
        Returns: string
      }
      change_fund_password_tx: {
        Args: {
          p_current_fund_password: string
          p_new_fund_password: string
          p_user_id: string
        }
        Returns: Json
      }
      claim_nowpayments_usdt_deposit_session: {
        Args: { p_user_id: string }
        Returns: Json
      }
      claim_nowpayments_usdt_withdrawal_review: {
        Args: {
          p_action_id: string
          p_admin_id: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      complete_nowpayments_usdt_deposit_session: {
        Args: {
          p_pay_address: string
          p_provider_created_at: string
          p_provider_payment_id: string
          p_provider_payment_status: string
          p_provider_valid_until: string
          p_qhash_order_id: string
          p_session_id: string
        }
        Returns: Json
      }
      complete_nowpayments_usdt_withdrawal: {
        Args: {
          p_action_id: string
          p_admin_id: string
          p_block_number: number
          p_chain_id: number
          p_confirmations: number
          p_destination_address: string
          p_exactly_one_matching_transfer: boolean
          p_net_amount_usdt: string
          p_token_contract: string
          p_transaction_hash: string
          p_transaction_success: boolean
          p_transfer_log_index: number
          p_verified_at: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      complete_nowpayments_usdt_withdrawal_manual: {
        Args: {
          p_action_id: string
          p_admin_id: string
          p_transaction_hash: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      configure_nowpayments_usdt_deposit_session_amounts: {
        Args: {
          p_provider_minimum_usdt: string
          p_qhash_order_id: string
          p_session_id: string
          p_technical_reference_amount_usdt: string
          p_user_id: string
        }
        Returns: Json
      }
      credit_investment_referral_reward: {
        Args: {
          p_investment_amount: number
          p_investment_id: string
          p_level: number
          p_percent: number
          p_purchaser_user_id: string
          p_referral_id: string
          p_referrer_user_id: string
        }
        Returns: Json
      }
      credit_mining_referral_reward: {
        Args: {
          p_earner_user_id: string
          p_earning_amount: number
          p_earning_transaction_id: string
          p_investment_id: string
          p_level: number
          p_percent: number
          p_referral_id: string
          p_referrer_user_id: string
        }
        Returns: Json
      }
      get_current_nowpayments_usdt_deposit_session: {
        Args: { p_user_id: string }
        Returns: Json
      }
      get_fund_password_status_tx: {
        Args: { p_user_id: string }
        Returns: Json
      }
      get_nowpayments_usdt_deposit_overview_snapshot: {
        Args: { p_user_id: string }
        Returns: Json
      }
      increment_wallet_balance: {
        Args: { p_amount: number; p_user_id: string }
        Returns: {
          balance_after: number
          balance_before: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      is_canonical_uuid_v4: { Args: { p_value: string }; Returns: boolean }
      lock_nowpayments_usdt_withdrawal_send: {
        Args: {
          p_action_id: string
          p_admin_id: string
          p_destination_manually_verified: boolean
          p_external_liquidity_confirmed: boolean
          p_withdrawal_id: string
        }
        Returns: Json
      }
      mark_nowpayments_usdt_deposit_session_manual_recovery: {
        Args: {
          p_pay_address: string
          p_provider_created_at: string
          p_provider_payment_id: string
          p_provider_payment_status: string
          p_provider_valid_until: string
          p_qhash_order_id: string
          p_reason: string
          p_session_id: string
        }
        Returns: Json
      }
      process_due_investment_earning: {
        Args: {
          p_investment_id: string
          p_run_id?: string
          p_trigger_type?: string
        }
        Returns: Json
      }
      purchase_plan_tx: {
        Args: { p_plan_id: string; p_user_id: string }
        Returns: Json
      }
      record_nowpayments_usdt_deposit_session_status: {
        Args: {
          p_provider_payment_id: string
          p_provider_payment_status: string
          p_qhash_order_id: string
          p_session_id: string
        }
        Returns: Json
      }
      record_nowpayments_usdt_withdrawal_broadcast: {
        Args: {
          p_action_id: string
          p_admin_id: string
          p_correction_reason?: string
          p_transaction_hash: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      reject_nowpayments_usdt_withdrawal: {
        Args: {
          p_action_id: string
          p_admin_id: string
          p_reason: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      reject_nowpayments_usdt_withdrawal_manual: {
        Args: {
          p_action_id: string
          p_admin_id: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      reject_withdrawal_tx: {
        Args: {
          p_admin_id: string
          p_admin_note?: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      request_nowpayments_usdt_withdrawal: {
        Args: {
          p_destination_address: string
          p_gross_amount_usdt: string
          p_request_id: string
          p_user_id: string
        }
        Returns: Json
      }
      request_withdrawal_tx: {
        Args: {
          p_account_name: string
          p_account_number: string
          p_amount: number
          p_method: Database["public"]["Enums"]["payment_method_type"]
          p_user_id: string
        }
        Returns: Json
      }
      reset_user_fund_password_tx: {
        Args: {
          p_admin_user_id: string
          p_reason: string
          p_target_user_id: string
        }
        Returns: Json
      }
      set_fund_password_tx: {
        Args: { p_fund_password: string; p_user_id: string }
        Returns: Json
      }
      settle_verified_nowpayments_usdt_payment: {
        Args: {
          p_actually_paid: string
          p_outcome_amount: string
          p_outcome_currency: string
          p_parent_provider_payment_id: string
          p_pay_address: string
          p_pay_currency: string
          p_provider_payment_id: string
          p_provider_payment_status: string
          p_qhash_order_id: string
        }
        Returns: Json
      }
      settle_verified_nowpayments_usdt_payment_serialized_inner: {
        Args: {
          p_actually_paid: string
          p_outcome_amount: string
          p_outcome_currency: string
          p_parent_provider_payment_id: string
          p_pay_address: string
          p_pay_currency: string
          p_provider_payment_id: string
          p_provider_payment_status: string
          p_qhash_order_id: string
        }
        Returns: Json
      }
      take_over_nowpayments_usdt_withdrawal: {
        Args: {
          p_action_id: string
          p_new_admin_id: string
          p_reason: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      verify_fund_password_tx: {
        Args: { p_fund_password: string; p_user_id: string }
        Returns: Json
      }
    }
    Enums: {
      deposit_status: "pending" | "approved" | "rejected"
      investment_status: "active" | "completed" | "cancelled"
      payment_method_type: "cbe" | "telebirr"
      transaction_status: "pending" | "completed" | "failed"
      transaction_type:
        | "deposit"
        | "withdrawal"
        | "plan_purchase"
        | "earning"
        | "referral_reward"
        | "admin_adjustment"
        | "referral_investment_bonus"
        | "referral_daily_bonus"
      withdrawal_status: "pending" | "approved" | "rejected"
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
      deposit_status: ["pending", "approved", "rejected"],
      investment_status: ["active", "completed", "cancelled"],
      payment_method_type: ["cbe", "telebirr"],
      transaction_status: ["pending", "completed", "failed"],
      transaction_type: [
        "deposit",
        "withdrawal",
        "plan_purchase",
        "earning",
        "referral_reward",
        "admin_adjustment",
        "referral_investment_bonus",
        "referral_daily_bonus",
      ],
      withdrawal_status: ["pending", "approved", "rejected"],
    },
  },
} as const
