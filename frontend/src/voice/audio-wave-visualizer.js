import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

export default function AudioWaveVisualizer({ active = false, barCount = 14 }) {
  const animations = useRef(
    Array.from({ length: barCount }, () => new Animated.Value(6))
  ).current;

  useEffect(() => {
    let isMounted = true;
    if (!active) {
      animations.forEach((anim) => {
        Animated.timing(anim, {
          toValue: 6,
          duration: 250,
          useNativeDriver: false,
        }).start();
      });
      return;
    }

    const animateBars = () => {
      if (!isMounted || !active) return;
      const parallelAnimations = animations.map((anim, index) => {
        // Vary heights with natural waveform look (higher in middle, lower on ends)
        const baseHeight = 12 + Math.sin((index / barCount) * Math.PI) * 26;
        const randomHeight = baseHeight + (Math.random() * 16 - 8);
        return Animated.sequence([
          Animated.timing(anim, {
            toValue: Math.max(6, Math.min(48, randomHeight)),
            duration: 120 + Math.random() * 80,
            useNativeDriver: false,
          }),
          Animated.timing(anim, {
            toValue: 8 + Math.random() * 12,
            duration: 120 + Math.random() * 80,
            useNativeDriver: false,
          }),
        ]);
      });

      Animated.parallel(parallelAnimations).start(() => {
        if (isMounted && active) animateBars();
      });
    };

    animateBars();

    return () => {
      isMounted = false;
    };
  }, [active]);

  return (
    <View style={styles.container}>
      {animations.map((anim, idx) => (
        <Animated.View
          key={idx}
          style={[
            styles.bar,
            {
              height: anim,
              backgroundColor: active ? (idx % 2 === 0 ? '#F0440B' : '#07152F') : '#CBD5E1',
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    gap: 4,
    marginVertical: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
  },
  bar: {
    width: 5,
    borderRadius: 3,
  },
});
