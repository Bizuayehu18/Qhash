import {
  Activity,
  BarChart3,
  Cpu,
  Database,
  Gem,
  Server,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";

const PLAN_ICONS: Record<string, LucideIcon> = {
  contract: ShieldCheck,
  hashrate: Activity,
  growth: BarChart3,
  node: Cpu,
  cluster: Server,
  vault: Database,
  enterprise: Gem,
};

export function PlanIcon({ iconKey, size = 17 }: { iconKey: string | null; size?: number }) {
  const Icon = PLAN_ICONS[iconKey ?? "contract"] ?? Zap;
  return <Icon size={size} />;
}
