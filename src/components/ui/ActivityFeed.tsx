import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowDownCircle, ArrowUpCircle, Zap, Award } from "lucide-react";
import { CurrencyUnit } from "@/components/ui/AmountText.js";

type ActivityType = "deposit" | "withdrawal" | "mining" | "earning";

interface FeedItem {
  id: number;
  type: ActivityType;
  user: string;
  amount: number;
  time: string;
}

const FIRST_NAMES = [
  "Abebe", "Dawit", "Selam", "Hana", "Yonas", "Kidist", "Bereket", "Meron",
  "Tsegaye", "Rahel", "Fikru", "Tigist", "Samuel", "Sara", "Daniel", "Liya",
  "Abel", "Bezawit", "Getachew", "Mahlet",
];

function maskName(name: string): string {
  return name[0] + "***" + name[name.length - 1];
}

function randomAmount(type: ActivityType): number {
  switch (type) {
    case "deposit": return Math.floor(500 + Math.random() * 9500);
    case "withdrawal": return Math.floor(200 + Math.random() * 4800);
    case "mining": return Math.floor(100 + Math.random() * 2000);
    case "earning": return +(5 + Math.random() * 95).toFixed(2);
  }
}

function randomTime(): string {
  const mins = Math.floor(Math.random() * 58) + 1;
  return `${mins}m ago`;
}

const TYPE_CONFIG: Record<ActivityType, { icon: typeof ArrowDownCircle; color: string; label: string }> = {
  deposit: { icon: ArrowDownCircle, color: "text-emerald-400", label: "deposited" },
  withdrawal: { icon: ArrowUpCircle, color: "text-amber-400", label: "withdrew" },
  mining: { icon: Zap, color: "text-[#00ff41]", label: "activated mining" },
  earning: { icon: Award, color: "text-purple-400", label: "earned" },
};

const ACTIVITY_TYPES: ActivityType[] = ["deposit", "withdrawal", "mining", "earning"];

let nextId = 0;

function generateItem(): FeedItem {
  const type = ACTIVITY_TYPES[Math.floor(Math.random() * ACTIVITY_TYPES.length)];
  return {
    id: nextId++,
    type,
    user: maskName(FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]),
    amount: randomAmount(type),
    time: randomTime(),
  };
}

export function ActivityFeed() {
  const [items, setItems] = useState<FeedItem[]>(() =>
    Array.from({ length: 4 }, generateItem)
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const addItem = useCallback(() => {
    setItems((prev) => [generateItem(), ...prev.slice(0, 5)]);
  }, []);

  useEffect(() => {
    intervalRef.current = setInterval(addItem, 5000 + Math.random() * 3000);
    return () => clearInterval(intervalRef.current);
  }, [addItem]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
          Live Activity
        </span>
        <div className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full bg-red-500 status-pulse" />
          <span className="text-[9px] text-gray-600">LIVE</span>
        </div>
      </div>

      <div className="bg-[#111] rounded-xl border border-[#1a1a1a] overflow-hidden">
        <div className="divide-y divide-[#1a1a1a]">
          {items.slice(0, 4).map((item) => {
            const config = TYPE_CONFIG[item.type];
            const Icon = config.icon;
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2.5 feed-item-enter"
              >
                <div className={`shrink-0 ${config.color}`}>
                  <Icon size={13} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-gray-300 truncate">
                    <span className="font-medium text-gray-200">{item.user}</span>
                    {" "}{config.label}{" "}
                    {item.type !== "mining" && (
                      <span className="font-mono text-gray-200">
                        {item.amount.toLocaleString()}<CurrencyUnit />
                      </span>
                    )}
                  </p>
                </div>
                <span className="text-[9px] text-gray-600 shrink-0">{item.time}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
