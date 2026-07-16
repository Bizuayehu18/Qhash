export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          phone: string
          referred_by: string | null
          is_admin: boolean
          is_frozen: boolean
          created_at: string
        }
        Insert: {
          id: string
          username: string
          phone: string
          referred_by?: string | null
          is_admin?: boolean
          is_frozen?: boolean
          created_at?: string
        }
        Update: {
          username?: string
          phone?: string
          referred_by?: string | null
          is_admin?: boolean
          is_frozen?: boolean
          created_at?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          user_id: string
          balance: number
          updated_at: string
        }
        Insert: {
          user_id: string
          balance?: number
          updated_at?: string
        }
        Update: {
          balance?: number
          updated_at?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          id: string
          name: string
          investment_amount: number
          daily_earning: number
          duration_days: number
          is_active: boolean
          max_active_per_user: number
          required_active_level1_referrals: number
          required_active_level2_referrals: number
          required_active_level3_referrals: number
          display_order: number
          is_popular: boolean
          icon_key: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          investment_amount: number
          daily_earning: number
          duration_days: number
          is_active?: boolean
          max_active_per_user?: number
          required_active_level1_referrals?: number
          required_active_level2_referrals?: number
          required_active_level3_referrals?: number
          display_order?: number
          is_popular?: boolean
          icon_key?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          investment_amount?: number
          daily_earning?: number
          duration_days?: number
          is_active?: boolean
          max_active_per_user?: number
          required_active_level1_referrals?: number
          required_active_level2_referrals?: number
          required_active_level3_referrals?: number
          display_order?: number
          is_popular?: boolean
          icon_key?: string | null
        }
        Relationships: []
      }
      investments: {
        Row: {
          id: string
          user_id: string
          plan_id: string
          invested_amount: number
          daily_earning: number
          start_date: string
          end_date: string
          ends_at: string | null
          next_earning_at: string | null
          status: InvestmentStatus
          last_earning_at: string | null
          total_earned: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          plan_id: string
          invested_amount: number
          daily_earning: number
          start_date?: string
          end_date: string
          ends_at?: string | null
          next_earning_at?: string | null
          status?: InvestmentStatus
          last_earning_at?: string | null
          total_earned?: number
          created_at?: string
        }
        Update: {
          invested_amount?: number
          daily_earning?: number
          start_date?: string
          end_date?: string
          ends_at?: string | null
          next_earning_at?: string | null
          status?: InvestmentStatus
          last_earning_at?: string | null
          total_earned?: number
        }
        Relationships: []
      }
      transactions: {
        Row: {
          id: string
          user_id: string
          type: TransactionType
          amount: number
          status: TransactionStatus
          balance_before: number | null
          balance_after: number | null
          description: string | null
          reference_id: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: TransactionType
          amount: number
          status?: TransactionStatus
          balance_before?: number | null
          balance_after?: number | null
          description?: string | null
          reference_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          type?: TransactionType
          amount?: number
          status?: TransactionStatus
          balance_before?: number | null
          balance_after?: number | null
          description?: string | null
          reference_id?: string | null
          metadata?: Json
        }
        Relationships: []
      }
      referrals: {
        Row: {
          id: string
          referrer_id: string
          referred_user_id: string
          level: number
          total_investment_rewards: number
          total_mining_rewards: number
          created_at: string
        }
        Insert: {
          id?: string
          referrer_id: string
          referred_user_id: string
          level: number
          total_investment_rewards?: number
          total_mining_rewards?: number
          created_at?: string
        }
        Update: {
          level?: number
          total_investment_rewards?: number
          total_mining_rewards?: number
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          id: string
          type: PaymentMethodType
          account_name: string
          account_number: string
          account_last_8: string | null
          instructions: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          type: PaymentMethodType
          account_name: string
          account_number: string
          account_last_8?: string | null
          instructions?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          type?: PaymentMethodType
          account_name?: string
          account_number?: string
          account_last_8?: string | null
          instructions?: string | null
          is_active?: boolean
        }
        Relationships: []
      }
      deposits: {
        Row: {
          id: string
          user_id: string
          amount: number
          payment_method_id: string
          transaction_reference: string
          status: DepositStatus
          admin_note: string | null
          reviewed_at: string | null
          receipt_url: string | null
          auto_verified: boolean
          verified_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          amount: number
          payment_method_id: string
          transaction_reference: string
          status?: DepositStatus
          admin_note?: string | null
          reviewed_at?: string | null
          receipt_url?: string | null
          auto_verified?: boolean
          verified_at?: string | null
          created_at?: string
        }
        Update: {
          status?: DepositStatus
          amount?: number
          admin_note?: string | null
          reviewed_at?: string | null
          receipt_url?: string | null
          auto_verified?: boolean
          verified_at?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          title: string
          message: string
          is_read: boolean
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          message: string
          is_read?: boolean
          metadata?: Json
          created_at?: string
        }
        Update: {
          is_read?: boolean
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          id: string
          user_id: string
          amount: number
          method: PaymentMethodType
          account_name: string
          account_number: string
          phone: string | null
          status: WithdrawalStatus
          admin_note: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          amount: number
          method: PaymentMethodType
          account_name: string
          account_number: string
          phone?: string | null
          status?: WithdrawalStatus
          admin_note?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
        }
        Update: {
          status?: WithdrawalStatus
          admin_note?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          value: string
          updated_at: string
        }
        Insert: {
          key: string
          value: string
          updated_at?: string
        }
        Update: {
          value?: string
          updated_at?: string
        }
        Relationships: []
      }
      crypto_deposit_addresses: {
        Row: {
          id: string
          user_id: string
          network: string
          asset: string
          address: string
          derivation_index: number | null
          activation_status: string
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          network: string
          asset?: string
          address: string
          derivation_index?: number | null
          activation_status?: string
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          network?: string
          asset?: string
          address?: string
          derivation_index?: number | null
          activation_status?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      crypto_deposits: {
        Row: {
          id: string
          user_id: string
          address_id: string | null
          network: string
          asset: string
          tx_hash: string
          event_index: number
          from_address: string
          to_address: string
          amount_raw: number
          amount_usdt: number
          block_number: number
          confirmations: number
          status: string
          exchange_rate_etb: number | null
          credited_amount_etb: number | null
          credited_transaction_id: string | null
          credited_by_admin_id: string | null
          detected_at: string
          confirmed_at: string | null
          credited_at: string | null
          swept_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          address_id?: string | null
          network: string
          asset?: string
          tx_hash: string
          event_index?: number
          from_address: string
          to_address: string
          amount_raw: number
          amount_usdt: number
          block_number: number
          confirmations?: number
          status?: string
          exchange_rate_etb?: number | null
          credited_amount_etb?: number | null
          credited_transaction_id?: string | null
          credited_by_admin_id?: string | null
          detected_at?: string
          confirmed_at?: string | null
          credited_at?: string | null
          swept_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          address_id?: string | null
          network?: string
          asset?: string
          tx_hash?: string
          event_index?: number
          from_address?: string
          to_address?: string
          amount_raw?: number
          amount_usdt?: number
          block_number?: number
          confirmations?: number
          status?: string
          exchange_rate_etb?: number | null
          credited_amount_etb?: number | null
          credited_transaction_id?: string | null
          credited_by_admin_id?: string | null
          detected_at?: string
          confirmed_at?: string | null
          credited_at?: string | null
          swept_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      crypto_sweep_jobs: {
        Row: {
          id: string
          crypto_deposit_id: string
          network: string
          from_address: string
          to_treasury_address: string
          amount_usdt: number
          status: string
          gas_topup_tx_hash: string | null
          sweep_tx_hash: string | null
          error_message: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          crypto_deposit_id: string
          network: string
          from_address: string
          to_treasury_address: string
          amount_usdt: number
          status?: string
          gas_topup_tx_hash?: string | null
          sweep_tx_hash?: string | null
          error_message?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          crypto_deposit_id?: string
          network?: string
          from_address?: string
          to_treasury_address?: string
          amount_usdt?: number
          status?: string
          gas_topup_tx_hash?: string | null
          sweep_tx_hash?: string | null
          error_message?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      crypto_watcher_state: {
        Row: {
          network: string
          last_scanned_block: number
          updated_at: string
        }
        Insert: {
          network: string
          last_scanned_block?: number
          updated_at?: string
        }
        Update: {
          network?: string
          last_scanned_block?: number
          updated_at?: string
        }
        Relationships: []
      }
      referral_reward_logs: {
        Row: {
          id: string
          investment_id: string | null
          earning_reference_id: string | null
          purchaser_user_id: string | null
          earner_user_id: string | null
          referrer_user_id: string
          referred_user_id: string
          level: number
          reward_type: string
          reward_amount: number
          created_at: string
        }
        Insert: {
          id?: string
          investment_id?: string | null
          earning_reference_id?: string | null
          purchaser_user_id?: string | null
          earner_user_id?: string | null
          referrer_user_id: string
          referred_user_id: string
          level: number
          reward_type: string
          reward_amount: number
          created_at?: string
        }
        Update: {
          reward_amount?: number
        }
        Relationships: []
      }
      earning_run_logs: {
        Row: {
          id: string
          run_id: string
          trigger_type: string
          started_at: string
          completed_at: string | null
          status: string
          total_active_investments: number
          total_users_processed: number
          total_investments_processed: number
          total_earnings_credited: number
          total_skipped: number
          total_completed_investments: number
          total_errors: number
          error_details: Json
          created_at: string
        }
        Insert: {
          id?: string
          run_id: string
          trigger_type: string
          started_at: string
          completed_at?: string | null
          status?: string
          total_active_investments?: number
          total_users_processed?: number
          total_investments_processed?: number
          total_earnings_credited?: number
          total_skipped?: number
          total_completed_investments?: number
          total_errors?: number
          error_details?: Json
          created_at?: string
        }
        Update: {
          completed_at?: string | null
          status?: string
          total_active_investments?: number
          total_users_processed?: number
          total_investments_processed?: number
          total_earnings_credited?: number
          total_skipped?: number
          total_completed_investments?: number
          total_errors?: number
          error_details?: Json
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      is_admin: {
        Args: Record<string, never>
        Returns: boolean
      }
      increment_wallet_balance: {
        Args: { p_user_id: string; p_amount: number }
        Returns: { balance_before: number; balance_after: number }[]
      }
      approve_deposit_tx: {
        Args: { p_deposit_id: string; p_admin_id: string; p_action: string; p_admin_note: string | null; p_amount?: number | null }
        Returns: Json
      }
      purchase_plan_tx: {
        Args: { p_user_id: string; p_plan_id: string }
        Returns: Json
      }
      credit_investment_referral_reward: {
        Args: {
          p_referral_id: string
          p_purchaser_user_id: string
          p_referrer_user_id: string
          p_investment_id: string
          p_level: number
          p_percent: number
          p_investment_amount: number
        }
        Returns: Json
      }
      process_due_investment_earning: {
        Args: { p_investment_id: string; p_run_id?: string | null; p_trigger_type?: string | null }
        Returns: Json
      }
      apply_bsc_crypto_deposit_confirmation: {
        Args: {
          p_deposit_id: string
          p_expected_user_id: string
          p_expected_address_id: string
          p_expected_tx_hash: string
          p_expected_event_index: number
          p_expected_from_address: string
          p_expected_to_address: string
          p_expected_amount_raw_text: string
          p_expected_amount_usdt_text: string
          p_expected_block_number: number
          p_expected_confirmations: number
          p_calculated_confirmations: number
          p_confirmation_threshold: number
        }
        Returns: Json
      }
      credit_confirmed_bsc_crypto_deposit: {
        Args: {
          p_deposit_id: string
          p_admin_id: string
          p_expected_user_id: string
          p_expected_address_id: string
          p_expected_tx_hash: string
          p_expected_event_index: number
          p_expected_from_address: string
          p_expected_to_address: string
          p_expected_amount_raw_text: string
          p_expected_amount_usdt_text: string
          p_expected_block_number: number
          p_expected_confirmations: number
          p_calculated_confirmations: number
          p_expected_exchange_rate_etb_text: string
          p_expected_credited_amount_etb_text: string
        }
        Returns: Json
      }
    }
    Enums: {
      transaction_type: TransactionType
      transaction_status: TransactionStatus
      investment_status: InvestmentStatus
      deposit_status: DepositStatus
      withdrawal_status: WithdrawalStatus
      payment_method_type: PaymentMethodType
    }
  }
}

export type Profile = Database['public']['Tables']['profiles']['Row']
export type Wallet = Database['public']['Tables']['wallets']['Row']
export type Plan = Database['public']['Tables']['plans']['Row']
export type Investment = Database['public']['Tables']['investments']['Row']
export type Transaction = Database['public']['Tables']['transactions']['Row']
export type PaymentMethod = Database['public']['Tables']['payment_methods']['Row']
export type Deposit = Database['public']['Tables']['deposits']['Row']
export type Withdrawal = Database['public']['Tables']['withdrawals']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']
export type AppSetting = Database['public']['Tables']['app_settings']['Row']
export type CryptoDepositAddress = Database['public']['Tables']['crypto_deposit_addresses']['Row']
export type CryptoDeposit = Database['public']['Tables']['crypto_deposits']['Row']
export type CryptoSweepJob = Database['public']['Tables']['crypto_sweep_jobs']['Row']
export type CryptoWatcherState = Database['public']['Tables']['crypto_watcher_state']['Row']
export type Referral = Database['public']['Tables']['referrals']['Row']
export type ReferralRewardLog = Database['public']['Tables']['referral_reward_logs']['Row']
export type EarningRunLog = Database['public']['Tables']['earning_run_logs']['Row']

export type TransactionType = 'deposit' | 'withdrawal' | 'investment' | 'plan_purchase' | 'earning' | 'admin_adjustment' | 'referral_reward' | 'referral_investment_bonus' | 'referral_daily_bonus'
export type TransactionStatus = 'completed' | 'pending' | 'failed'
export type InvestmentStatus = 'active' | 'completed' | 'cancelled'
export type DepositStatus = 'pending' | 'approved' | 'rejected'
export type WithdrawalStatus = 'pending' | 'approved' | 'rejected'
export type PaymentMethodType = 'cbe' | 'telebirr'
