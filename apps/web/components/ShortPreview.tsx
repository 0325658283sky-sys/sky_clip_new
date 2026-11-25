'use client';

import { Player } from '@remotion/player';
import { Short } from '@skycut/renderer/src/Short';
import type { Clip, Project } from '@skycut/schema';
import { getTemplate } from '@skycut/templates';
import { resolve } from '@skycut/core';
import { useMemo } from 'react';
import { mediaUrl } from '@/lib/api';

interface Props {
  project: Project;
  clip: Clip;
  templateId: string;
  titleIndex: number;
  width: number;
}

/**
 * 미리보기.
 *
 * 서버를 거치지 않고 브라우저에서 바로 resolve()를 돌린다. 템플릿을 바꾸면
 * 다시 계산해 곧바로 반영된다 — 재분석이 없으니 체감이 즉각적이다.
 */
export function ShortPreview({ project, clip, templateId, titleIndex, width }: Props) {
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
}
