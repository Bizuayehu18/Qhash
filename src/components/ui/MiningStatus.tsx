import { useState, useEffect, useRef } from "react";
import { Activity, Cpu, Gauge, Users, Zap } from "lucide-react";

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function formatNum(n: number, decimals = 1) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

interface MiningStats {
  hashRate: number;
  efficiency: number;
  activeMiners: number;
  dailyOutput: number;
}

export function MiningStatus() {
  const [stats, setStats] = useState<MiningStats>({
    hashRate: randomBetween(142, 158),
    efficiency: randomBetween(94, 99),
    activeMiners: Math.floor(randomBetween(1240, 1380)),
    dailyOutput: randomBetween(24.5, 28.2),
  });
  const [flashKey, setFlashKey] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setStats((prev) => ({
        hashRate: Math.max(130, Math.min(165, prev.hashRate + randomBetween(-3, 3))),
        efficiency: Math.max(91, Math.min(99.8, prev.efficiency + randomBetween(-0.5, 0.5))),
        activeMiners: Math.max(1200, Math.min(1420, prev.activeMiners + Math.floor(randomBetween(-8, 8)))),
        dailyOutput: Math.max(22, Math.min(30, prev.dailyOutput + randomBetween(-0.3, 0.3))),
      }));
      setFlashKey((k) => k + 1);
    }, 4000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const items = [
    {
      icon: Cpu,
      label: "Hash Rate",
      value: `${formatNum(stats.hashRate)} TH/s`,
      accent: true,
    },
    {
      icon: Gauge,
      label: "Efficiency",
      value: `${formatNum(stats.efficiency)}%`,
      accent: false,
    },
    {
      icon: Users,
      label: "Active Miners",
      value: stats.activeMiners.toLocaleString(),
      accent: false,
    },
    {
      icon: Zap,
      label: "Daily Output",
      value: `${formatNum(stats.dailyOutput)} ETB/TH`,
      accent: false,
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <Activity size={13} className="text-[#00ff41]" />
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
          Network Status
        </span>
        <span className="h-1.5 w-1.5 rounded-full bg-[#00ff41] status-pulse ml-auto" />
        <span className="text-[10px] text-gray-600">Live</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="mining-stat-card rounded-xl p-3"
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon size={12} className="text-gray-500" />
                <span className="text-[10px] text-gray-500">{item.label}</span>
              </div>
              <p
                key={flashKey}
                className={`text-sm font-bold value-update ${item.accent ? "neon-text" : "stat-value-glow"}`}
              >
                {item.value}
              </p>
            </div>
          );
        })}
      </div>

      {/* Scan bar indicator */}
      <div className="h-[1px] bg-[#1a1a1a] rounded-full overflow-hidden mt-1">
        <div className="h-full w-full bg-gradient-to-r from-transparent via-[#00ff41] to-transparent scan-bar opacity-40" />
      </div>
    </div>
  );
}
