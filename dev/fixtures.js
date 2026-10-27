window.makeCrossChatFixture = () => {
  const sources = [
    { key: 'twitch:riotgames', platform: 'twitch', label: 'riotgames', displayName: 'Riot Games', url: 'https://www.twitch.tv/riotgames', color: '#a78bfa', groups: ['League of Legends', 'Proplay'], liveState: 'live', statusReason: 'Preview live stream', checkedAt: Date.now(), streamTitle: 'Worlds — main broadcast' },
    { key: 'twitch:tarik', platform: 'twitch', label: 'tarik', displayName: 'Tarik', url: 'https://www.twitch.tv/tarik', color: '#38bdf8', groups: ['Valorant'], liveState: 'offline', statusReason: 'Preview offline stream', checkedAt: Date.now(), streamTitle: '' },
    { key: 'youtube:previewWorlds', platform: 'youtube', label: 'YouTube video previewWorlds', displayName: 'Worlds on YouTube', url: 'https://www.youtube.com/watch?v=previewWorlds', color: '#fb7185', groups: ['League of Legends'], liveState: 'unknown', statusReason: 'Preview: sign in to check', checkedAt: null, streamTitle: 'Worlds — alternate broadcast' }
  ];
  let serial = 0;
  const messages = Array.from({ length: 100 }, (_, i) => {
    const source = sources[i % sources.length];
    return { id: `preview-${serial++}`, platform: source.platform, origin: source.platform === 'twitch' ? 'twitch-eventsub' : 'youtube-api', sourceKey: source.key, sourceLabel: source.displayName,
      author: ['PixelPilot', 'CozyByte', 'MayaPlays'][i % 3], text: `Message ${i + 1}: That play was incredible! Watching the same match together.`, time: Date.now() - (100 - i) * 20000, local: false };
  });
  return { sources, messages, viewPrefs: { width: 400, height: 700, selectedGroups: [], hiddenSources: [] }, serial: () => serial++, pair: { key: 'preview-room', sources } };
};
