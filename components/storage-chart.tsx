"use client";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { demoService, formatSize, useDemo } from "./demo-store";
export function StorageChart() {
  const state = useDemo(); const data = demoService.cloudUsage(state.items); const total = data.reduce((sum, i) => sum + i.value, 0);
  return <div className="chart-wrap" role="img" aria-label={`Managed cloud sample content: ${formatSize(total)} across Gmail and Drive. Account-wide total unavailable.`}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" innerRadius={58} outerRadius={78} paddingAngle={2} minAngle={2} stroke="none" isAnimationActive={false}>{data.map((i) => <Cell key={i.name} fill={i.color} />)}</Pie><Tooltip formatter={(value) => formatSize(Number(value))} /></PieChart></ResponsiveContainer><div className="chart-center"><b>{formatSize(total)}</b><span>sample content</span></div></div>;
}
