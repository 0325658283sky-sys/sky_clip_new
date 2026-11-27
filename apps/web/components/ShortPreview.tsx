'use client';

import { Player, type PlayerRef } from '@remotion/player';
import { Short } from '@skycut/renderer/src/Short';
import type { Clip, Project } from '@skycut/schema';
import { getTemplate } from '@skycut/templates';
import { resolve } from '@skycut/core';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { mediaUrl } from '@/lib/api';

interface Props {
  project: Project;
  clip: Clip;
  templateId: string;
  titleIndex: number;
  width: number;
  onPlay?: () => void;
}

export interface ShortPreviewHandle {
  pause(): void;
}

export const ShortPreview = forwardRef<ShortPreviewHandle, Props>(
  function ShortPreview({ project, clip, templateId, titleIndex, width, onPlay }, fwdRef) {
    const playerRef = useRef<PlayerRef>(null);

    useImperativeHandle(fwdRef, () => ({
      pause() {
        playerRef.current?.pause();
      },
    }));

    useEffect(() => {
      const player = playerRef.current;
      if (!player || !onPlay) return;
      player.addEventListener('play', onPlay);
      return () => player.removeEventListener('play', onPlay);
    }, [onPlay]);

    const timeline = useMemo(
      () =>
        resolve({
          project,
          clip: { ...clip, selectedTitleIndex: titleIndex },
          template: getTemplate(templateId),
          mode: 'preview',
        }),
      [project, clip, templateId, titleIndex],
    );

    const inputProps = useMemo(
      () => ({ timeline, assets: project.assets, resolveAssetUrl: mediaUrl }),
      [timeline, project.assets],
    );

    const height = Math.round((width * timeline.height) / timeline.width);

    return (
      <Player
        ref={playerRef}
        component={Short as never}
        inputProps={inputProps as never}
        durationInFrames={timeline.durationInFrames}
        fps={timeline.fps}
        compositionWidth={timeline.width}
        compositionHeight={timeline.height}
        style={{ width, height, borderRadius: 8, overflow: 'hidden' }}
        controls
        doubleClickToFullscreen
        acknowledgeRemotionLicense
      />
    );
  },
);
