/**
 * Database types for Sitara Traders
 * Mirrors the Supabase PostgreSQL schema exactly.
 *
 * Phase 1: clients, contracts, payments, payment_edits, installments,
 * user_profiles (auth/roles).
 * Phase 2: investors, business_phases, investor_phase_investments,
 * profit_distributions, withdrawals — plus the profit_distributed guard
 * columns on contracts and the distribute_contract_profit /
 * investor_available_balance Postgres functions.
 */

// ─────────────────────────────────────────────────────────────────────────
// Enums / literal unions
// ─────────────────────────────────────────────────────────────────────────

export type UserRole = "admin" | "partner";

export type ContractStatus = "ACTIVE" | "COMPLETED" | "OVERDUE";

export type InstallmentStatus = "PENDING" | "PARTIAL" | "PAID" | "OVERDUE";

export type PaymentMethod =
  | "Cash"
  | "Bank Transfer"
  | "JazzCash"
  | "Easypaisa"
  | "Custom";

export type PhaseStatus = "ACTIVE" | "CLOSED";

// ─────────────────────────────────────────────────────────────────────────
// Row types (exact DB shape — snake_case, matches Postgres columns)
// ─────────────────────────────────────────────────────────────────────────

export type ClientRow = {
  id: number;
  client_code: string;
  name: string;
  cnic: string | null;
  phone: string | null;
  address: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  sync_version: number;
}

export type ContractRow = {
  id: number;
  contract_code: string;
  client_id: number;
  product_name: string;
  product_description: string | null;
  initiated_by: string;
  purchase_price: number;
  profit_percent: number;
  profit_amount: number;
  total_price: number;
  number_of_installments: number;
  amount_per_installment: number;
  remaining_balance: number;
  start_date: string;
  expected_end_date: string | null;
  status: ContractStatus;
  overdue_months: number;
  phase_id: number | null;
  guarantor_name: string | null;
  guarantor_phone: string | null;
  guarantor_address: string | null;
  guarantor_cnic: string | null;
  profit_distributed: boolean;
  profit_distributed_at: string | null;
  created_at: string;
  updated_at: string;
  sync_version: number;
}

export type InstallmentRow = {
  id: number;
  contract_id: number;
  installment_number: number;
  due_date: string;
  installment_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: InstallmentStatus;
  created_at: string;
  updated_at: string;
}

export type PaymentRow = {
  id: number;
  contract_id: number;
  amount_paid: number;
  remaining_balance: number;
  payment_method: PaymentMethod | null;
  remarks: string | null;
  payment_date: string;
  created_at: string;
  updated_at: string;
  sync_version: number;
}

export type PaymentEditRow = {
  id: number;
  payment_id: number;
  old_amount: number | null;
  new_amount: number | null;
  reason: string | null;
  edited_by: string | null;
  edited_at: string;
}

export type UserProfileRow = {
  id: string; // uuid, matches auth.users.id
  email: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
}

// ── Investor / phase / distribution tables (Phase 2) ──

export type InvestorRow = {
  id: number;
  name: string;
  active: boolean;
  created_at: string;
}

export type BusinessPhaseRow = {
  id: number;
  phase_name: string;
  start_date: string;
  end_date: string | null;
  status: PhaseStatus;
  created_at: string;
}

export type InvestorPhaseInvestmentRow = {
  id: number;
  phase_id: number;
  investor_id: number;
  investment_amount: number;
  created_at: string;
}

export type ProfitDistributionRow = {
  id: number;
  contract_id: number;
  phase_id: number | null;
  investor_id: number | null;
  profit_amount: number;
  created_at: string;
}

export type ContractInvestorSnapshotRow = {
  id: number;
  contract_id: number;
  phase_id: number;
  investor_id: number;
  investment_amount: number;
  percent_of_pool: number;
  created_at: string;
}

export type WithdrawalRow = {
  id: number;
  investor_id: number;
  amount: number;
  reason: string | null;
  withdrawal_date: string;
  created_at: string;
  updated_at: string;
  sync_version: number;
}

export type CashLedgerEntryRow = {
  id: number;
  entry_type:
    | "investment"
    | "loan"
    | "payment_received"
    | "purchase"
    | "withdrawal"
    | "loan_repayment"
    | "business_expense";
  amount: number;
  contract_id: number | null;
  investor_id: number | null;
  investment_id: number | null;
  loan_id: number | null;
  withdrawal_id: number | null;
  payment_id: number | null;
  business_expense_id: number | null;
  description: string | null;
  entry_date: string;
  created_at: string;
}

export type BusinessExpenseCategory =
  | "rent"
  | "utilities"
  | "salaries"
  | "fuel_transport"
  | "office_supplies"
  | "maintenance_repair"
  | "marketing"
  | "taxes_fees"
  | "other";

export type BusinessExpenseRow = {
  id: number;
  title: string;
  amount: number;
  category: BusinessExpenseCategory;
  expense_date: string;
  notes: string | null;
  receipt_reference: string | null;
  created_at: string;
  updated_at: string;
}

export type ContractDeletionLogRow = {
  id: number;
  contract_id: number;
  contract_code: string;
  client_id: number | null;
  cash_reversed: boolean;
  deleted_by: string | null;
  deleted_by_email: string | null;
  snapshot: unknown;
  created_at: string;
}

export type LoanRow = {
  id: number;
  lender_name: string;
  amount: number;
  reason: string | null;
  loan_date: string;
  amount_repaid: number;
  status: "ACTIVE" | "REPAID";
  created_at: string;
  updated_at: string;
  sync_version: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Supabase Database generic type (for createClient<Database>())
//
// IMPORTANT: @supabase/postgrest-js requires every table to declare a
// `Relationships` array (used to resolve embedded `.select("*, foo(*)")`
// joins) and the schema to declare `Tables`, `Views`, and `Functions` --
// omitting any of these silently collapses every query's inferred type
// to `never`. Insert/Update are kept as loose Partial<Row> (required-field
// validation already happens at the Zod layer before any insert).
// ─────────────────────────────────────────────────────────────────────────

export interface Database {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      clients: {
        Row: ClientRow;
        Insert: Partial<ClientRow>;
        Update: Partial<ClientRow>;
        Relationships: [];
      };
      contracts: {
        Row: ContractRow;
        Insert: Partial<ContractRow>;
        Update: Partial<ContractRow>;
        Relationships: [
          {
            foreignKeyName: "contracts_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contracts_phase_id_fkey";
            columns: ["phase_id"];
            isOneToOne: false;
            referencedRelation: "business_phases";
            referencedColumns: ["id"];
          }
        ];
      };
      installments: {
        Row: InstallmentRow;
        Insert: Partial<InstallmentRow>;
        Update: Partial<InstallmentRow>;
        Relationships: [
          {
            foreignKeyName: "installments_contract_id_fkey";
            columns: ["contract_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          }
        ];
      };
      payments: {
        Row: PaymentRow;
        Insert: Partial<PaymentRow>;
        Update: Partial<PaymentRow>;
        Relationships: [
          {
            foreignKeyName: "payments_contract_id_fkey";
            columns: ["contract_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          }
        ];
      };
      payment_edits: {
        Row: PaymentEditRow;
        Insert: Partial<PaymentEditRow>;
        Update: Partial<PaymentEditRow>;
        Relationships: [
          {
            foreignKeyName: "payment_edits_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          }
        ];
      };
      user_profiles: {
        Row: UserProfileRow;
        Insert: Partial<UserProfileRow>;
        Update: Partial<UserProfileRow>;
        Relationships: [];
      };
      investors: {
        Row: InvestorRow;
        Insert: Partial<InvestorRow>;
        Update: Partial<InvestorRow>;
        Relationships: [];
      };
      business_phases: {
        Row: BusinessPhaseRow;
        Insert: Partial<BusinessPhaseRow>;
        Update: Partial<BusinessPhaseRow>;
        Relationships: [];
      };
      investor_phase_investments: {
        Row: InvestorPhaseInvestmentRow;
        Insert: Partial<InvestorPhaseInvestmentRow>;
        Update: Partial<InvestorPhaseInvestmentRow>;
        Relationships: [
          {
            foreignKeyName: "investor_phase_investments_phase_id_fkey";
            columns: ["phase_id"];
            isOneToOne: false;
            referencedRelation: "business_phases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "investor_phase_investments_investor_id_fkey";
            columns: ["investor_id"];
            isOneToOne: false;
            referencedRelation: "investors";
            referencedColumns: ["id"];
          }
        ];
      };
      profit_distributions: {
        Row: ProfitDistributionRow;
        Insert: Partial<ProfitDistributionRow>;
        Update: Partial<ProfitDistributionRow>;
        Relationships: [
          {
            foreignKeyName: "profit_distributions_contract_id_fkey";
            columns: ["contract_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profit_distributions_investor_id_fkey";
            columns: ["investor_id"];
            isOneToOne: false;
            referencedRelation: "investors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profit_distributions_phase_id_fkey";
            columns: ["phase_id"];
            isOneToOne: false;
            referencedRelation: "business_phases";
            referencedColumns: ["id"];
          }
        ];
      };
      contract_investor_snapshots: {
        Row: ContractInvestorSnapshotRow;
        Insert: Partial<ContractInvestorSnapshotRow>;
        Update: Partial<ContractInvestorSnapshotRow>;
        Relationships: [
          {
            foreignKeyName: "contract_investor_snapshots_contract_id_fkey";
            columns: ["contract_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contract_investor_snapshots_investor_id_fkey";
            columns: ["investor_id"];
            isOneToOne: false;
            referencedRelation: "investors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contract_investor_snapshots_phase_id_fkey";
            columns: ["phase_id"];
            isOneToOne: false;
            referencedRelation: "business_phases";
            referencedColumns: ["id"];
          }
        ];
      };
      business_expenses: {
        Row: BusinessExpenseRow;
        Insert: Partial<BusinessExpenseRow>;
        Update: Partial<BusinessExpenseRow>;
        Relationships: [];
      };
      withdrawals: {
        Row: WithdrawalRow;
        Insert: Partial<WithdrawalRow>;
        Update: Partial<WithdrawalRow>;
        Relationships: [
          {
            foreignKeyName: "withdrawals_investor_id_fkey";
            columns: ["investor_id"];
            isOneToOne: false;
            referencedRelation: "investors";
            referencedColumns: ["id"];
          }
        ];
      };
      cash_ledger: {
        Row: CashLedgerEntryRow;
        Insert: Partial<CashLedgerEntryRow>;
        Update: Partial<CashLedgerEntryRow>;
        Relationships: [
          {
            foreignKeyName: "cash_ledger_contract_id_fkey";
            columns: ["contract_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_ledger_investor_id_fkey";
            columns: ["investor_id"];
            isOneToOne: false;
            referencedRelation: "investors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_ledger_investment_id_fkey";
            columns: ["investment_id"];
            isOneToOne: false;
            referencedRelation: "investor_phase_investments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_ledger_loan_id_fkey";
            columns: ["loan_id"];
            isOneToOne: false;
            referencedRelation: "loans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_ledger_withdrawal_id_fkey";
            columns: ["withdrawal_id"];
            isOneToOne: false;
            referencedRelation: "withdrawals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_ledger_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          }
        ];
      };
      loans: {
        Row: LoanRow;
        Insert: Partial<LoanRow>;
        Update: Partial<LoanRow>;
        Relationships: [];
      };
      contract_deletion_log: {
        Row: ContractDeletionLogRow;
        Insert: Partial<ContractDeletionLogRow>;
        Update: Partial<ContractDeletionLogRow>;
        Relationships: [
          {
            foreignKeyName: "contract_deletion_log_deleted_by_fkey";
            columns: ["deleted_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      next_client_code: {
        Args: Record<string, never>;
        Returns: string;
      };
      next_contract_code: {
        Args: Record<string, never>;
        Returns: string;
      };
      distribute_contract_profit: {
        Args: { p_contract_id: number };
        Returns: ProfitDistributionRow[];
      };
      snapshot_contract_investors: {
        Args: { p_contract_id: number };
        Returns: void;
      };
      create_business_expense_with_balance_check: {
        Args: {
          p_title: string;
          p_amount: number;
          p_category: BusinessExpenseCategory;
          p_expense_date: string;
          p_notes: string | null;
          p_receipt_reference: string | null;
        };
        Returns: BusinessExpenseRow[];
      };
      update_business_expense_with_balance_check: {
        Args: {
          p_expense_id: number;
          p_title: string;
          p_amount: number;
          p_category: BusinessExpenseCategory;
          p_expense_date: string;
          p_notes: string | null;
          p_receipt_reference: string | null;
        };
        Returns: BusinessExpenseRow[];
      };
      investor_available_balance: {
        Args: { p_investor_id: number };
        Returns: number;
      };
      create_withdrawal_with_balance_check: {
        Args: {
          p_investor_id: number;
          p_amount: number;
          p_reason: string | null;
          p_withdrawal_date: string;
        };
        Returns: WithdrawalRow[];
      };
      current_cash_in_hand: {
        Args: Record<string, never>;
        Returns: number;
      };
      get_database_size_bytes: {
        Args: Record<string, never>;
        Returns: number;
      };
      create_loan: {
        Args: {
          p_lender_name: string;
          p_amount: number;
          p_reason: string | null;
          p_loan_date: string;
        };
        Returns: LoanRow[];
      };
      record_loan_repayment: {
        Args: {
          p_loan_id: number;
          p_amount: number;
          p_repayment_date: string;
        };
        Returns: LoanRow[];
      };
      delete_contract: {
        Args: {
          p_contract_id: number;
          p_reverse_cash: boolean;
        };
        Returns: ContractDeletionLogRow;
      };
    };
  };
}