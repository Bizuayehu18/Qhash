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
      nowpayments_usdt_config: {
        Row: {
          id: 'USDT-BEP20'
          enabled: boolean
          asset: 'USDT'
          network: 'BEP20'
          provider_currency: 'usdtbsc'
          deposit_minimum_usdt: number
          withdrawal_minimum_usdt: number
          withdrawal_fee_percent: number
          withdrawals_enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: 'USDT-BEP20'
          enabled?: boolean
          asset?: 'USDT'
          network?: 'BEP20'
          provider_currency?: 'usdtbsc'
          deposit_minimum_usdt?: number
          withdrawal_minimum_usdt?: number
          withdrawal_fee_percent?: number
          withdrawals_enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          withdrawals_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      nowpayments_usdt_wallets: {
        Row: {
          user_id: string
          asset: 'USDT'
          available_balance_usdt: number
          reserved_balance_usdt: number
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          asset?: 'USDT'
          available_balance_usdt?: number
          reserved_balance_usdt?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          asset?: 'USDT'
          available_balance_usdt?: number
          reserved_balance_usdt?: number
          updated_at?: string
        }
        Relationships: []
      }
      nowpayments_usdt_payments: {
        Row: {
          id: string
          user_id: string
          provider_payment_id: string | null
          provider_payment_status: NowpaymentsProviderPaymentStatus | null
          verification_status: NowpaymentsVerificationStatus
          asset: 'USDT'
          network: 'BEP20'
          provider_currency: 'usdtbsc'
          qhash_order_id: string
          session_status: NowpaymentsDepositSessionStatus
          pay_address: string | null
          technical_reference_amount_usdt: number | null
          provider_minimum_usdt: number | null
          provider_created_at: string | null
          provider_valid_until: string | null
          address_activated_at: string | null
          provisioning_started_at: string
          provisioned_at: string | null
          manual_recovery_at: string | null
          manual_recovery_reason: NowpaymentsManualRecoveryReason | null
          terminal_at: string | null
          terminal_reason: string | null
          settled_by_provider_payment_id: string | null
          outcome_amount: number | null
          outcome_currency: 'USDT'
          verified_at: string | null
          credited_amount_usdt: number | null
          credited_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider_payment_id?: string | null
          provider_payment_status?: NowpaymentsProviderPaymentStatus | null
          verification_status?: NowpaymentsVerificationStatus
          asset?: 'USDT'
          network?: 'BEP20'
          provider_currency?: 'usdtbsc'
          qhash_order_id?: string
          session_status?: NowpaymentsDepositSessionStatus
          pay_address?: string | null
          technical_reference_amount_usdt?: number | null
          provider_minimum_usdt?: number | null
          provider_created_at?: string | null
          provider_valid_until?: string | null
          address_activated_at?: string | null
          provisioning_started_at?: string
          provisioned_at?: string | null
          manual_recovery_at?: string | null
          manual_recovery_reason?: NowpaymentsManualRecoveryReason | null
          terminal_at?: string | null
          terminal_reason?: string | null
          settled_by_provider_payment_id?: string | null
          outcome_amount?: number | null
          outcome_currency?: 'USDT'
          verified_at?: string | null
          credited_amount_usdt?: number | null
          credited_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          provider_payment_id?: string | null
          provider_payment_status?: NowpaymentsProviderPaymentStatus | null
          verification_status?: NowpaymentsVerificationStatus
          qhash_order_id?: string
          session_status?: NowpaymentsDepositSessionStatus
          pay_address?: string | null
          technical_reference_amount_usdt?: number | null
          provider_minimum_usdt?: number | null
          provider_created_at?: string | null
          provider_valid_until?: string | null
          address_activated_at?: string | null
          provisioning_started_at?: string
          provisioned_at?: string | null
          manual_recovery_at?: string | null
          manual_recovery_reason?: NowpaymentsManualRecoveryReason | null
          terminal_at?: string | null
          terminal_reason?: string | null
          settled_by_provider_payment_id?: string | null
          outcome_amount?: number | null
          verified_at?: string | null
          credited_amount_usdt?: number | null
          credited_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      nowpayments_usdt_provider_payments: {
        Row: {
          id: string
          session_id: string
          user_id: string
          provider_payment_id: string
          parent_provider_payment_id: string | null
          payment_kind: NowpaymentsProviderPaymentKind
          qhash_order_id: string
          pay_address: string
          pay_currency: 'usdtbsc'
          provider_payment_status: NowpaymentsProviderPaymentStatus
          actually_paid_usdt: number | null
          outcome_amount_usdt: number | null
          outcome_currency: 'usdtbsc' | null
          credited_amount_usdt: number | null
          provider_verified_at: string
          credited_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          session_id: string
          user_id: string
          provider_payment_id: string
          parent_provider_payment_id?: string | null
          payment_kind: NowpaymentsProviderPaymentKind
          qhash_order_id: string
          pay_address: string
          pay_currency?: 'usdtbsc'
          provider_payment_status: NowpaymentsProviderPaymentStatus
          actually_paid_usdt?: number | null
          outcome_amount_usdt?: number | null
          outcome_currency?: 'usdtbsc' | null
          credited_amount_usdt?: number | null
          provider_verified_at?: string
          credited_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          provider_payment_status?: NowpaymentsProviderPaymentStatus
          actually_paid_usdt?: number | null
          outcome_amount_usdt?: number | null
          outcome_currency?: 'usdtbsc' | null
          credited_amount_usdt?: number | null
          provider_verified_at?: string
          credited_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      nowpayments_usdt_withdrawals: {
        Row: {
          id: string
          user_id: string
          destination_address: string
          asset: 'USDT'
          network: 'BEP20'
          provider_currency: 'usdtbsc'
          gross_amount_usdt: number
          fee_percent: number
          fee_amount_usdt: number
          net_amount_usdt: number
          status: NowpaymentsWithdrawalStatus
          requested_at: string
          initial_admin_id: string | null
          current_admin_id: string | null
          claimed_at: string | null
          send_locked_at: string | null
          broadcasted_at: string | null
          completed_at: string | null
          rejected_at: string | null
          rejection_reason: string | null
          current_broadcast_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          destination_address: string
          asset?: 'USDT'
          network?: 'BEP20'
          provider_currency?: 'usdtbsc'
          gross_amount_usdt: number
          fee_percent?: number
          status?: NowpaymentsWithdrawalStatus
          requested_at?: string
          initial_admin_id?: string | null
          current_admin_id?: string | null
          claimed_at?: string | null
          send_locked_at?: string | null
          broadcasted_at?: string | null
          completed_at?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          current_broadcast_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: NowpaymentsWithdrawalStatus
          initial_admin_id?: string | null
          current_admin_id?: string | null
          claimed_at?: string | null
          send_locked_at?: string | null
          broadcasted_at?: string | null
          completed_at?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          current_broadcast_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      nowpayments_usdt_withdrawal_events: {
        Row: {
          id: string
          withdrawal_id: string
          user_id: string
          actor_id: string
          action_id: string
          action_type: NowpaymentsWithdrawalActionType
          from_status: NowpaymentsWithdrawalStatus | null
          to_status: NowpaymentsWithdrawalStatus
          canonical_payload: string
          result_snapshot: Json
          created_at: string
        }
        Insert: {
          id?: string
          withdrawal_id: string
          user_id: string
          actor_id: string
          action_id: string
          action_type: NowpaymentsWithdrawalActionType
          from_status?: NowpaymentsWithdrawalStatus | null
          to_status: NowpaymentsWithdrawalStatus
          canonical_payload: string
          result_snapshot: Json
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      nowpayments_usdt_withdrawal_broadcasts: {
        Row: {
          id: string
          withdrawal_id: string
          recorded_by: string
          transaction_hash: string
          destination_address: string
          net_amount_usdt: number
          supersedes_broadcast_id: string | null
          correction_reason: string | null
          recorded_at: string
        }
        Insert: {
          id?: string
          withdrawal_id: string
          recorded_by: string
          transaction_hash: string
          destination_address: string
          net_amount_usdt: number
          supersedes_broadcast_id?: string | null
          correction_reason?: string | null
          recorded_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      nowpayments_usdt_withdrawal_verifications: {
        Row: {
          id: string
          withdrawal_id: string
          broadcast_id: string
          verified_by: string
          chain_id: 56
          token_contract: '0x55d398326f99059ff775485246999027b3197955'
          transaction_success: true
          exactly_one_matching_transfer: true
          destination_address: string
          net_amount_usdt: number
          block_number: number
          transfer_log_index: number
          confirmations: number
          verified_at: string
          created_at: string
        }
        Insert: {
          id?: string
          withdrawal_id: string
          broadcast_id: string
          verified_by: string
          chain_id?: 56
          token_contract?: '0x55d398326f99059ff775485246999027b3197955'
          transaction_success?: true
          exactly_one_matching_transfer?: true
          destination_address: string
          net_amount_usdt: number
          block_number: number
          transfer_log_index: number
          confirmations: number
          verified_at: string
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      nowpayments_usdt_ledger_entries: {
        Row: {
          id: string
          user_id: string
          entry_type: NowpaymentsUsdtLedgerEntryType
          asset: 'USDT'
          available_delta_usdt: number
          reserved_delta_usdt: number
          available_before_usdt: number
          available_after_usdt: number
          reserved_before_usdt: number
          reserved_after_usdt: number
          payment_id: string | null
          provider_payment_record_id: string | null
          withdrawal_id: string | null
          description: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          entry_type: NowpaymentsUsdtLedgerEntryType
          asset?: 'USDT'
          available_delta_usdt?: number
          reserved_delta_usdt?: number
          available_before_usdt: number
          available_after_usdt: number
          reserved_before_usdt: number
          reserved_after_usdt: number
          payment_id?: string | null
          provider_payment_record_id?: string | null
          withdrawal_id?: string | null
          description?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: Record<string, never>
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
      settle_verified_nowpayments_usdt_payment: {
        Args: {
          p_provider_payment_id: string
          p_parent_provider_payment_id: string | null
          p_qhash_order_id: string | null
          p_pay_address: string
          p_pay_currency: 'usdtbsc'
          p_provider_payment_status: NowpaymentsProviderPaymentStatus
          p_actually_paid: string | null
          p_outcome_amount: string | null
          p_outcome_currency: 'usdtbsc' | null
        }
        Returns: Json
      }
      get_current_nowpayments_usdt_deposit_session: {
        Args: { p_user_id: string }
        Returns: Json
      }
      claim_nowpayments_usdt_deposit_session: {
        Args: { p_user_id: string }
        Returns: Json
      }
      configure_nowpayments_usdt_deposit_session_amounts: {
        Args: {
          p_user_id: string
          p_session_id: string
          p_qhash_order_id: string
          p_provider_minimum_usdt: string
          p_technical_reference_amount_usdt: string
        }
        Returns: Json
      }
      complete_nowpayments_usdt_deposit_session: {
        Args: {
          p_session_id: string
          p_qhash_order_id: string
          p_provider_payment_id: string
          p_pay_address: string
          p_provider_payment_status: NowpaymentsProviderPaymentStatus
          p_provider_created_at: string
          p_provider_valid_until: string
        }
        Returns: Json
      }
      mark_nowpayments_usdt_deposit_session_manual_recovery: {
        Args: {
          p_session_id: string
          p_qhash_order_id: string
          p_reason: NowpaymentsManualRecoveryReason
          p_provider_payment_id: string | null
          p_pay_address: string | null
          p_provider_payment_status: NowpaymentsProviderPaymentStatus | null
          p_provider_created_at: string | null
          p_provider_valid_until: string | null
        }
        Returns: Json
      }
      record_nowpayments_usdt_deposit_session_status: {
        Args: {
          p_session_id: string
          p_qhash_order_id: string
          p_provider_payment_id: string
          p_provider_payment_status: NowpaymentsProviderPaymentStatus
        }
        Returns: Json
      }
      request_nowpayments_usdt_withdrawal: {
        Args: {
          p_user_id: string
          p_request_id: string
          p_gross_amount_usdt: string
          p_destination_address: string
        }
        Returns: Json
      }
      claim_nowpayments_usdt_withdrawal_review: {
        Args: { p_withdrawal_id: string; p_admin_id: string; p_action_id: string }
        Returns: Json
      }
      lock_nowpayments_usdt_withdrawal_send: {
        Args: {
          p_withdrawal_id: string
          p_admin_id: string
          p_action_id: string
          p_external_liquidity_confirmed: boolean
          p_destination_manually_verified: boolean
        }
        Returns: Json
      }
      record_nowpayments_usdt_withdrawal_broadcast: {
        Args: {
          p_withdrawal_id: string
          p_admin_id: string
          p_action_id: string
          p_transaction_hash: string
          p_correction_reason: string | null
        }
        Returns: Json
      }
      complete_nowpayments_usdt_withdrawal: {
        Args: {
          p_withdrawal_id: string
          p_admin_id: string
          p_action_id: string
          p_transaction_hash: string
          p_chain_id: number
          p_token_contract: string
          p_transaction_success: boolean
          p_exactly_one_matching_transfer: boolean
          p_destination_address: string
          p_net_amount_usdt: string
          p_block_number: number
          p_transfer_log_index: number
          p_confirmations: number
          p_verified_at: string
        }
        Returns: Json
      }
      reject_nowpayments_usdt_withdrawal: {
        Args: {
          p_withdrawal_id: string
          p_admin_id: string
          p_action_id: string
          p_reason: string
        }
        Returns: Json
      }
      take_over_nowpayments_usdt_withdrawal: {
        Args: {
          p_withdrawal_id: string
          p_new_admin_id: string
          p_action_id: string
          p_reason: string
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
export type NowpaymentsUsdtConfig = Database['public']['Tables']['nowpayments_usdt_config']['Row']
export type NowpaymentsUsdtWallet = Database['public']['Tables']['nowpayments_usdt_wallets']['Row']
export type NowpaymentsUsdtPayment = Database['public']['Tables']['nowpayments_usdt_payments']['Row']
export type NowpaymentsUsdtProviderPayment = Database['public']['Tables']['nowpayments_usdt_provider_payments']['Row']
export type NowpaymentsUsdtWithdrawal = Database['public']['Tables']['nowpayments_usdt_withdrawals']['Row']
export type NowpaymentsUsdtWithdrawalEvent = Database['public']['Tables']['nowpayments_usdt_withdrawal_events']['Row']
export type NowpaymentsUsdtWithdrawalBroadcast = Database['public']['Tables']['nowpayments_usdt_withdrawal_broadcasts']['Row']
export type NowpaymentsUsdtWithdrawalVerification = Database['public']['Tables']['nowpayments_usdt_withdrawal_verifications']['Row']
export type NowpaymentsUsdtLedgerEntry = Database['public']['Tables']['nowpayments_usdt_ledger_entries']['Row']
export type CryptoDepositAddress = Database['public']['Tables']['crypto_deposit_addresses']['Row']
export type CryptoDeposit = Database['public']['Tables']['crypto_deposits']['Row']
export type Referral = Database['public']['Tables']['referrals']['Row']
export type ReferralRewardLog = Database['public']['Tables']['referral_reward_logs']['Row']
export type EarningRunLog = Database['public']['Tables']['earning_run_logs']['Row']

export type TransactionType = 'deposit' | 'withdrawal' | 'investment' | 'plan_purchase' | 'earning' | 'admin_adjustment' | 'referral_reward' | 'referral_investment_bonus' | 'referral_daily_bonus'
export type TransactionStatus = 'completed' | 'pending' | 'failed'
export type InvestmentStatus = 'active' | 'completed' | 'cancelled'
export type DepositStatus = 'pending' | 'approved' | 'rejected'
export type WithdrawalStatus = 'pending' | 'approved' | 'rejected'
export type PaymentMethodType = 'cbe' | 'telebirr'
export type NowpaymentsVerificationStatus = 'pending' | 'verified' | 'rejected'
export type NowpaymentsProviderPaymentKind = 'original' | 'repeated'
export type NowpaymentsProviderPaymentStatus = 'waiting' | 'partially_paid' | 'confirming' | 'confirmed' | 'sending' | 'finished' | 'failed' | 'refunded' | 'expired'
export type NowpaymentsDepositSessionStatus = 'provisioning' | 'ready' | 'manual_recovery' | 'terminal'
export type NowpaymentsManualRecoveryReason = 'stale_provisioning_claim' | 'create_payment_timeout' | 'create_payment_network_error' | 'create_payment_http_error' | 'create_payment_invalid_response' | 'create_payment_finalize_failed' | 'payment_status_invalid_response'
export type NowpaymentsWithdrawalStatus = 'reserved' | 'reviewing' | 'send_locked' | 'broadcasted' | 'completed' | 'rejected'
export type NowpaymentsWithdrawalActionType = 'request' | 'claim_review' | 'send_lock' | 'record_broadcast' | 'complete' | 'reject' | 'admin_takeover'
export type NowpaymentsUsdtLedgerEntryType = 'deposit_credit' | 'deposit_credit_correction' | 'withdrawal_reserve' | 'withdrawal_release' | 'withdrawal_settlement' | 'admin_adjustment'
