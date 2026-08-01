export type PlanEligibility = {
  activeLevel1Referrals: number;
  activeLevel2Referrals: number;
  activeLevel3Referrals: number;
  activePlanCount: number;
  isEligible: boolean;
  limitReached: boolean;
  maxActivePerUser: number;
  referralRequirementMet: boolean;
  requiredLevel1Referrals: number;
  requiredLevel2Referrals: number;
  requiredLevel3Referrals: number;
};

export type PlanCatalogItem = {
  daily_earning: number;
  duration_days: number;
  eligibility: PlanEligibility;
  icon_key: string | null;
  id: string;
  investment_amount: number;
  is_popular: boolean;
  name: string;
};
