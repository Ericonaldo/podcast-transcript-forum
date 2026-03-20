import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import './MediaPlayer.css';

// ── Platform detection ──
function detectPlatform(episodeUrl, audioUrl) {
  const urls = [episodeUrl, audioUrl].filter(Boolean);
  for (const url of urls) {
    if (/youtube\.com|youtu\.be/i.test(url)) return { platform: 'youtube', url };
    if (/bilibili\.com|b23\.tv/i.test(url)) return { platform: 'bilibili', url };
    if (/open\.spotify\.com/i.test(url)) return { platform: 'spotify', url };
    if (/podcasts\.apple\.com/i.test(url)) return { platform: 'apple', url };
    if (/soundcloud\.com/i.test(url)) return { platform: 'soundcloud', url };
    if (/xiaoyuzhoufm\.com/i.test(url)) return { platform: 'xiaoyuzhou', url };
  }
  // Fallback: direct audio
  if (audioUrl) return { platform: 'audio', url: audioUrl };
  if (episodeUrl) return { platform: 'link', url: episodeUrl };
  return null;
}

// ── ID extraction helpers ──
function extractYouTubeId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/|\/v\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function extractBilibiliId(url) {
  const bv = url.match(/(BV[a-zA-Z0-9]+)/i);
  if (bv) return { type: 'bvid', id: bv[1] };
  const av = url.match(/av(\d+)/i);
  if (av) return { type: 'aid', id: av[1] };
  return null;
}

function extractSpotifyId(url) {
  const m = url.match(/episode\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

// ── YouTube IFrame API loader (singleton) ──
let ytApiPromise = null;
function loadYouTubeAPI() {
  if (ytApiPromise) return ytApiPromise;
  if (window.YT && window.YT.Player) {
    ytApiPromise = Promise.resolve();
    return ytApiPromise;
  }
  ytApiPromise = new Promise(resolve => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

// ── Platform badge info ──
const PLATFORM_INFO = {
  youtube:    { name: 'YouTube',    color: '#FF0000', icon: '▶' },
  bilibili:   { name: 'Bilibili',   color: '#00A1D6', icon: '▶' },
  spotify:    { name: 'Spotify',    color: '#1DB954', icon: '♫' },
  apple:      { name: 'Apple Podcasts', color: '#9B59B6', icon: '♫' },
  soundcloud: { name: 'SoundCloud', color: '#FF5500', icon: '☁' },
  xiaoyuzhou: { name: '小宇宙',     color: '#EE6723', icon: '🎙' },
  audio:      { name: '音频播放',    color: '#6366f1', icon: '♪' },
  link:       { name: '外部链接',    color: '#525d73', icon: '↗' },
};

// ── Main MediaPlayer component ──
const MediaPlayer = forwardRef(function MediaPlayer({ episodeUrl, audioUrl, onTimeUpdate, onPlayStateChange }, ref) {
  const detected = detectPlatform(episodeUrl, audioUrl);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const playerInstanceRef = useRef(null);
  const containerRef = useRef(null);
  const audioRef = useRef(null);
  const iframeRef = useRef(null);
  const pollingRef = useRef(null);

  // Expose seekTo + getCurrentTime
  useImperativeHandle(ref, () => ({
    seekTo: (seconds) => {
      const p = detected?.platform;
      if (p === 'youtube' && playerInstanceRef.current?.seekTo) {
        playerInstanceRef.current.seekTo(seconds, true);
      } else if (p === 'audio' && audioRef.current) {
        audioRef.current.currentTime = seconds;
        if (audioRef.current.paused) audioRef.current.play();
      }
      // Other platforms don't reliably support seek from host
    },
    getCurrentTime: () => {
      const p = detected?.platform;
      if (p === 'youtube' && playerInstanceRef.current?.getCurrentTime) {
        return playerInstanceRef.current.getCurrentTime();
      }
      if (p === 'audio' && audioRef.current) {
        return audioRef.current.currentTime;
      }
      return null;
    },
    get canSeek() {
      const p = detected?.platform;
      return p === 'youtube' || p === 'audio';
    },
    get platform() {
      return detected?.platform;
    }
  }), [detected]);

  // ── YouTube player ──
  useEffect(() => {
    if (!detected || detected.platform !== 'youtube') return;
    const videoId = extractYouTubeId(detected.url);
    if (!videoId || !containerRef.current) return;

    let player = null;
    let destroyed = false;

    loadYouTubeAPI().then(() => {
      if (destroyed) return;
      player = new window.YT.Player(containerRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => { setReady(true); },
          onStateChange: (e) => {
            const playing = e.data === window.YT.PlayerState.PLAYING;
            onPlayStateChange?.(playing);
          },
          onError: () => { setError('YouTube 视频加载失败'); }
        }
      });
      playerInstanceRef.current = player;
    });

    return () => {
      destroyed = true;
      if (player && player.destroy) {
        try { player.destroy(); } catch (_) {}
      }
      playerInstanceRef.current = null;
    };
  }, [detected?.platform, detected?.url]);

  // ── Time update polling for YouTube ──
  useEffect(() => {
    if (!detected || detected.platform !== 'youtube') return;
    pollingRef.current = setInterval(() => {
      if (playerInstanceRef.current?.getCurrentTime) {
        const t = playerInstanceRef.current.getCurrentTime();
        if (t != null) onTimeUpdate?.(t);
      }
    }, 400);
    return () => clearInterval(pollingRef.current);
  }, [detected?.platform, onTimeUpdate]);

  // ── HTML5 Audio time update ──
  const handleAudioTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      onTimeUpdate?.(audioRef.current.currentTime);
    }
  }, [onTimeUpdate]);

  const handleAudioPlay = useCallback(() => onPlayStateChange?.(true), [onPlayStateChange]);
  const handleAudioPause = useCallback(() => onPlayStateChange?.(false), [onPlayStateChange]);

  if (!detected) return null;

  const info = PLATFORM_INFO[detected.platform] || PLATFORM_INFO.link;

  // ── Render by platform ──
  function renderPlayer() {
    switch (detected.platform) {
      case 'youtube': {
        const videoId = extractYouTubeId(detected.url);
        if (!videoId) return <div className="media-player__error">无法解析 YouTube 链接</div>;
        return (
          <div className="media-player__embed media-player__embed--video">
            <div ref={containerRef} className="media-player__yt-container" />
          </div>
        );
      }

      case 'bilibili': {
        const bid = extractBilibiliId(detected.url);
        if (!bid) return <div className="media-player__error">无法解析 Bilibili 链接</div>;
        const param = bid.type === 'bvid' ? `bvid=${bid.id}` : `aid=${bid.id}`;
        const src = `//player.bilibili.com/player.html?${param}&high_quality=1&danmaku=0&autoplay=0`;
        return (
          <div className="media-player__embed media-player__embed--video">
            <iframe
              ref={iframeRef}
              src={src}
              scrolling="no"
              frameBorder="0"
              allowFullScreen
              allow="autoplay"
              title="Bilibili Player"
            />
            <div className="media-player__note">B站播放器暂不支持时间戳跳转</div>
          </div>
        );
      }

      case 'spotify': {
        const epId = extractSpotifyId(detected.url);
        if (!epId) return <div className="media-player__error">无法解析 Spotify 链接</div>;
        return (
          <div className="media-player__embed media-player__embed--spotify">
            <iframe
              src={`https://open.spotify.com/embed/episode/${epId}?theme=0`}
              width="100%"
              height="152"
              frameBorder="0"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              title="Spotify Player"
            />
          </div>
        );
      }

      case 'apple': {
        // Apple Podcasts embed: convert URL to embed URL
        const embedUrl = detected.url.replace('podcasts.apple.com', 'embed.podcasts.apple.com');
        return (
          <div className="media-player__embed media-player__embed--apple">
            <iframe
              src={embedUrl}
              width="100%"
              height="175"
              frameBorder="0"
              allow="autoplay *; encrypted-media *"
              sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-top-navigation-by-user-activation"
              loading="lazy"
              title="Apple Podcasts Player"
            />
          </div>
        );
      }

      case 'soundcloud': {
        const scUrl = encodeURIComponent(detected.url);
        return (
          <div className="media-player__embed media-player__embed--soundcloud">
            <iframe
              src={`https://w.soundcloud.com/player/?url=${scUrl}&color=%236366f1&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false`}
              width="100%"
              height="120"
              scrolling="no"
              frameBorder="0"
              allow="autoplay"
              loading="lazy"
              title="SoundCloud Player"
            />
          </div>
        );
      }

      case 'xiaoyuzhou': {
        // 小宇宙 doesn't support embed; show link + audio fallback
        return (
          <div className="media-player__fallback">
            <a href={detected.url} target="_blank" rel="noopener noreferrer" className="media-player__ext-link">
              在小宇宙中打开 ↗
            </a>
            {audioUrl && audioUrl !== detected.url && (
              <audio
                ref={audioRef}
                src={audioUrl}
                controls
                preload="metadata"
                className="media-player__audio-el"
                onTimeUpdate={handleAudioTimeUpdate}
                onPlay={handleAudioPlay}
                onPause={handleAudioPause}
              />
            )}
          </div>
        );
      }

      case 'audio': {
        return (
          <div className="media-player__embed media-player__embed--audio">
            <div className="media-player__audio-visual">
              <div className="media-player__audio-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
            </div>
            <audio
              ref={audioRef}
              src={detected.url}
              controls
              preload="metadata"
              className="media-player__audio-el"
              onTimeUpdate={handleAudioTimeUpdate}
              onPlay={handleAudioPlay}
              onPause={handleAudioPause}
            />
          </div>
        );
      }

      case 'link':
      default:
        return (
          <div className="media-player__fallback">
            <a href={detected.url} target="_blank" rel="noopener noreferrer" className="media-player__ext-link">
              打开原始链接 ↗
            </a>
          </div>
        );
    }
  }

  return (
    <div className={`media-player media-player--${detected.platform}`}>
      <div className="media-player__badge" style={{ '--platform-color': info.color }}>
        <span className="media-player__badge-icon">{info.icon}</span>
        <span className="media-player__badge-name">{info.name}</span>
        {detected.platform === 'youtube' || detected.platform === 'audio' ? (
          <span className="media-player__badge-sync">同步播放</span>
        ) : null}
      </div>
      {error ? (
        <div className="media-player__error">{error}</div>
      ) : (
        renderPlayer()
      )}
    </div>
  );
});

export default MediaPlayer;
