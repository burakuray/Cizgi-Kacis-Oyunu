import React, { useEffect, useState } from 'react';
import Svg from 'react-native-svg';
import { renderOp } from '@/components/BoardArt';
import type { Palette } from '@/lib/boardArt';
import { SCENE_SIZE, sceneArt } from '@/lib/scenes';

type Props = { chapterId: string; kind: 'open' | 'end'; palette: Palette; duration?: number };

/** A small animated comic panel above the story text. Progress is driven by a simple frame loop. */
export function StoryScene({ chapterId, kind, palette, duration = 2600 }: Props) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    let frame = 0;
    const step = () => {
      const p = Math.min(1, (Date.now() - startedAt) / duration);
      setProgress(p);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [chapterId, kind, duration]);
  const art = sceneArt(chapterId, kind, progress, palette);
  return (
    <Svg width="100%" height={SCENE_SIZE.height} viewBox={`0 0 ${SCENE_SIZE.width} ${SCENE_SIZE.height}`} preserveAspectRatio="xMidYMid meet">
      {art.ops.map((op, index) => renderOp(op, `scene-${index}`))}
    </Svg>
  );
}
