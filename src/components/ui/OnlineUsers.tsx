import { useState, useEffect, useRef } from "react";

export function OnlineUsers() {
  const [count, setCount] = useState(() => Math.floor(820 + Math.random() * 200));
  const [ticking, setTicking] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setTicking(true);
      setCount((prev) => {
        const delta = Math.floor(Math.random() * 15) - 6;
        return Math.max(750, Math.min(1100, prev + delta));
      });
      setTimeout(() => setTicking(false), 300);
    }, 6000);
    return () => clearInterval(intervalRef.current);
  }, []);

  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[#00ff41] opacity-40 status-pulse" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#00ff41]" />
      </span>
      <span className="text-[10px] text-gray-500">
        <span className={`font-mono font-medium text-gray-400 ${ticking ? "counter-tick" : ""}`}>
          {count.toLocaleString()}
        </span>
        {" "}online
      </span>
    </div>
  );
}
