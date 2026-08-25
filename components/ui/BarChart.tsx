import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { LabelText } from './Typography';
import { Colors } from '@/constants/theme';

interface BarChartProps {
  data: { label: string; value: number }[];
  height?: number;
}

/** Minimal hand-rolled bar chart — no charting dependency, matches the app's "simple stats" scope. */
export function BarChart({ data, height = 140 }: BarChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = 100 / data.length;

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
        {data.map((d, i) => {
          const barHeight = (d.value / max) * (height - 8);
          const isActive = activeIndex === i;
          return (
            <Rect
              key={d.label}
              x={i * barWidth + barWidth * 0.2}
              y={height - barHeight}
              width={barWidth * 0.6}
              height={barHeight}
              rx={3}
              fill={isActive ? Colors.primary : Colors.surfaceContainer}
            />
          );
        })}
      </Svg>
      <View className="mt-2 flex-row">
        {data.map((d, i) => (
          <Pressable key={d.label} onPress={() => setActiveIndex(i)} style={{ width: `${barWidth}%` }} className="items-center">
            <LabelText className={activeIndex === i ? 'font-inter-semibold text-primary' : undefined}>{d.label}</LabelText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
