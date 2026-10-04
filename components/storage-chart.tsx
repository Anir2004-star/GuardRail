"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const data = [
  { name: "Google Drive", value: 142, color: "#5b2a68" },
  { name: "Gmail", value: 86, color: "#d97732" },
  { name: "Google Photos", value: 58, color: "#e9b765" },
  { name: "Available", value: 114, color: "#eee9e4" },
];

export function StorageChart() {
  return <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" innerRadius={58} outerRadius={78} paddingAngle={2} stroke="none">{data.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip formatter={(value) => `${value} GB`} /></PieChart></ResponsiveContainer><div className="chart-center"><b>286</b><span>GB used</span></div></div>;
}
