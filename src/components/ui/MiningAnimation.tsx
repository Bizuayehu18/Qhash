import { useMemo } from "react";

function generateHash() {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < 16; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export function MiningAnimation() {
  const hashes = useMemo(
    () => Array.from({ length: 6 }, () => generateHash()),
    []
  );

  const nodes = useMemo(
    () => [
      { cx: 20, cy: 20, delay: 0 },
      { cx: 60, cy: 15, delay: 0.5 },
      { cx: 100, cy: 25, delay: 1.0 },
      { cx: 40, cy: 45, delay: 0.3 },
      { cx: 80, cy: 40, delay: 0.8 },
      { cx: 120, cy: 35, delay: 1.3 },
    ],
    []
  );

  const connections = useMemo(
    () => [
      [0, 1], [1, 2], [0, 3], [3, 4], [4, 5], [1, 4], [2, 5],
    ],
    []
  );

  return (
    <div className="relative w-full h-full overflow-hidden rounded-xl">
      {/* Hash stream background */}
      <div className="hash-stream absolute inset-0 flex flex-col justify-between px-2 py-1">
        {hashes.map((hash, i) => (
          <div
            key={i}
            className="hash-line"
            style={{
              "--duration": `${3 + i * 0.8}s`,
              "--delay": `${i * 0.5}s`,
            } as React.CSSProperties}
          >
            {hash}
          </div>
        ))}
      </div>

      {/* Network graph overlay */}
      <svg
        viewBox="0 0 140 60"
        className="absolute inset-0 w-full h-full"
        fill="none"
        preserveAspectRatio="xMidYMid meet"
      >
        {connections.map(([a, b], i) => (
          <line
            key={i}
            x1={nodes[a].cx}
            y1={nodes[a].cy}
            x2={nodes[b].cx}
            y2={nodes[b].cy}
            stroke="rgba(0,255,65,0.1)"
            strokeWidth="0.5"
            className="data-line"
          />
        ))}
        {nodes.map((node, i) => (
          <circle
            key={i}
            cx={node.cx}
            cy={node.cy}
            r="2.5"
            fill="rgba(0,255,65,0.3)"
            className="node-dot"
            style={{ "--speed": `${2 + i * 0.3}s`, "--delay": `${node.delay}s` } as React.CSSProperties}
          />
        ))}
      </svg>
    </div>
  );
}
