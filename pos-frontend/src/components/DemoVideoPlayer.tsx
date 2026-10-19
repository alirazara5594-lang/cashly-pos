import React from 'react';
import type { VideoSource } from '../utils/videoEmbed';

/** A demo video, 16:9, playing as soon as it opens. */
export const DemoVideoPlayer: React.FC<{ source: VideoSource; title: string }> = ({ source, title }) => (
  <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black">
    {source.kind === 'embed' ? (
      <iframe key={source.src} src={source.src} title={title} className="w-full h-full"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen />
    ) : (
      <video key={source.src} src={source.src} title={title} controls autoPlay playsInline className="w-full h-full" />
    )}
  </div>
);
