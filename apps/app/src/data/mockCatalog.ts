export type Playlist = {
  id: string;
  title: string;
  subtitle: string;
  initials: string;
  colors: readonly [string, string];
};

export type Song = {
  id: string;
  title: string;
  artist: string;
  playlistId: string;
};

export const mockPlaylists: Playlist[] = [
  {
    id: "playlist-liked-songs",
    title: "Liked Songs",
    subtitle: "Everything you love",
    initials: "LS",
    colors: ["#08b878", "#067b5a"]
  },
  {
    id: "playlist-deep-focus",
    title: "Deep Focus",
    subtitle: "Keep calm and concentrate",
    initials: "DF",
    colors: ["#34343d", "#0a0a0d"]
  },
  {
    id: "playlist-chill-vibes",
    title: "Chill Vibes",
    subtitle: "Wind down with the chillest beats",
    initials: "CV",
    colors: ["#0877ae", "#28206d"]
  },
  {
    id: "playlist-workout-mix",
    title: "Workout Mix",
    subtitle: "High energy, full power",
    initials: "WM",
    colors: ["#f13a00", "#a90f19"]
  },
  {
    id: "playlist-road-trip",
    title: "Road Trip",
    subtitle: "Songs for the open road",
    initials: "RT",
    colors: ["#ff9800", "#b20a42"]
  },
  {
    id: "playlist-late-night",
    title: "Late Night",
    subtitle: "For the after hours",
    initials: "LN",
    colors: ["#7119c7", "#08080b"]
  }
];

export const mockSongs: Song[] = [
  {
    id: "song-moonlit",
    title: "Moonlit Arcade",
    artist: "Nova Vale",
    playlistId: "playlist-late-night"
  },
  {
    id: "song-static-skyline",
    title: "Static Skyline",
    artist: "The North Room",
    playlistId: "playlist-deep-focus"
  },
  {
    id: "song-open-road",
    title: "Open Road Signal",
    artist: "Mara Lake",
    playlistId: "playlist-road-trip"
  }
];

export const mockLibrarySongs: Song[] = [];

export const browseCategories = [
  { id: "pop", title: "Pop", colors: ["#ed2c95", "#b80055"] as const },
  { id: "hip-hop", title: "Hip-Hop", colors: ["#f57c00", "#c83a00"] as const },
  { id: "rock", title: "Rock", colors: ["#9f2525", "#361f1f"] as const },
  { id: "indie", title: "Indie", colors: ["#079d70", "#06775e"] as const },
  { id: "electronic", title: "Electronic", colors: ["#05acc8", "#24307e"] as const },
  { id: "jazz", title: "Jazz", colors: ["#a33a00", "#5c1f00"] as const },
  { id: "classical", title: "Classical", colors: ["#686973", "#3c3d43"] as const },
  { id: "lo-fi", title: "Lo-Fi", colors: ["#7c18ee", "#37137b"] as const }
];
