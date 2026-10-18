import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, Image, BackHandler,
  Alert, Modal, ActivityIndicator, Platform, StatusBar, Pressable, Animated, Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as MediaLibrary from 'expo-media-library';
import * as DocumentPicker from 'expo-document-picker';
import { WebView } from 'react-native-webview';
import Svg, { Circle } from 'react-native-svg';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { createAudioPlayer, setAudioModeAsync, useAudioPlayerStatus } from 'expo-audio';

/* ============================== THEME / HELPERS ============================== */
const C = {
  bg: '#07070A', card: '#121218', red: '#A50925', crim: '#FF2448',
  burg: '#390813', silver: '#D1D1DA', white: '#FFFFFF',
};
const STORE = 'a1_state_v1';
const VERSION = '1.0.0';
const TOP = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44;
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
const cleanName = (n) => (n || 'Unknown').replace(/\.[^/.]+$/, '').replace(/[_]+/g, ' ');
const DEFAULT_DATA = { fav: [], recent: [], plays: {}, playlists: [], ytKey: '' };

/* ============================== SMALL COMPONENTS ============================== */
const Empty = ({ icon = 'skull-outline', text, sub }) => (
  <View style={s.empty}>
    <Ionicons name={icon} size={42} color={C.red} />
    <Text style={s.emptyT}>{text}</Text>
    {sub ? <Text style={s.emptyS}>{sub}</Text> : null}
  </View>
);

const Btn = ({ icon, label, onPress, style }) => (
  <TouchableOpacity onPress={onPress} style={[s.btn, style]} activeOpacity={0.8}>
    {icon ? <Ionicons name={icon} size={18} color={C.white} /> : null}
    <Text style={s.btnT}>{label}</Text>
  </TouchableOpacity>
);

const Art = ({ track, size, round }) => {
  const br = round ? size / 2 : 12;
  return track && track.art ? (
    <Image source={{ uri: track.art }} style={{ width: size, height: size, borderRadius: br, backgroundColor: C.burg }} />
  ) : (
    <LinearGradient colors={['#6b0a1e', C.bg]} style={{ width: size, height: size, borderRadius: br, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.red }}>
      <Ionicons name="musical-notes" size={size * 0.42} color={C.crim} />
    </LinearGradient>
  );
};

const Hero = ({ title, sub, onPlay }) => (
  <View style={{ marginBottom: 38 }}>
    <LinearGradient colors={['#C4092E', '#4a0612', '#120709']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
      <Ionicons name="skull" size={150} color="#ffffff14" style={{ position: 'absolute', right: -10, top: 10 }} />
      <Text style={s.heroT}>{title}</Text>
      <Text style={s.heroS}>{sub}</Text>
    </LinearGradient>
    <TouchableOpacity onPress={onPlay} style={s.heroPlay} activeOpacity={0.85}>
      <Ionicons name="play" size={30} color={C.white} style={{ marginLeft: 3 }} />
    </TouchableOpacity>
  </View>
);

const Ring = ({ size, progress, children }) => {
  const r = (size - 5) / 2, c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="#2e2e36" strokeWidth={3} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.crim} strokeWidth={3} fill="none" strokeLinecap="round"
          strokeDasharray={String(c)} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress || 0)))} />
      </Svg>
      {children}
    </View>
  );
};

// Spinning vinyl disc with red glow ring (spins only while playing, native driver)
const Disc = ({ track, playing, size }) => {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (playing) {
      rot.stopAnimation((v) => {
        const f = (v || 0) % 1;
        rot.setValue(f);
        Animated.timing(rot, { toValue: f + 2000, duration: 2000 * 14000, easing: Easing.linear, useNativeDriver: true }).start();
      });
    } else rot.stopAnimation();
  }, [playing]);
  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const ring = size * 1.14, inner = size * 0.62;
  return (
    <View style={{ width: ring, height: ring, borderRadius: ring / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: C.red, shadowColor: C.crim, shadowOpacity: 1, shadowRadius: 30, elevation: 26 }}>
      <LinearGradient colors={['#FF2448', '#5a0a1a']} style={{ position: 'absolute', width: ring, height: ring, borderRadius: ring / 2 }} />
      <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#0b0b0e', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: spin }] }}>
        {[0.94, 0.86, 0.78].map((k) => (
          <View key={k} style={{ position: 'absolute', width: size * k, height: size * k, borderRadius: size * k / 2, borderWidth: 1, borderColor: '#ffffff14' }} />
        ))}
        <Art track={track} size={inner} round />
        <View style={{ position: 'absolute', width: size * 0.08, height: size * 0.08, borderRadius: size * 0.04, backgroundColor: '#0b0b0e', borderWidth: 1, borderColor: '#ffffff22' }} />
      </Animated.View>
    </View>
  );
};

const TrackRow = React.memo(({ t, active, fav, onPress, onMore }) => (
  <TouchableOpacity onPress={onPress} style={[s.row, active && { borderColor: C.crim }]} activeOpacity={0.8}>
    <Art track={t} size={46} />
    <View style={{ flex: 1, marginHorizontal: 12 }}>
      <Text numberOfLines={1} style={[s.rowT, active && { color: C.crim }]}>{t.title}</Text>
      <Text numberOfLines={1} style={s.rowS}>{t.artist} {t.duration ? '· ' + fmt(t.duration) : ''}</Text>
    </View>
    {fav ? <Ionicons name="heart" size={16} color={C.crim} style={{ marginRight: 10 }} /> : null}
    <TouchableOpacity onPress={onMore} hitSlop={10}><Ionicons name="ellipsis-vertical" size={18} color={C.silver} /></TouchableOpacity>
  </TouchableOpacity>
));

const Card = ({ t, onPress }) => (
  <TouchableOpacity onPress={onPress} style={s.card} activeOpacity={0.8}>
    <Art track={t} size={120} />
    <Text numberOfLines={1} style={s.cardT}>{t.title}</Text>
    <Text numberOfLines={1} style={s.cardS}>{t.artist}</Text>
  </TouchableOpacity>
);

const Section = ({ title, data, onPlay, emptyText }) => (
  <View style={{ marginTop: 22 }}>
    <Text style={s.h2}>{title}</Text>
    {data.length === 0 ? <Text style={s.emptyInline}>{emptyText}</Text> : (
      <FlatList horizontal data={data} keyExtractor={(x) => x.id} showsHorizontalScrollIndicator={false}
        renderItem={({ item, index }) => <Card t={item} onPress={() => onPlay(data, index)} />} />
    )}
  </View>
);

// Light visualizer: only animates while playing (cheap, native driver)
const Bars = ({ playing }) => {
  const vals = useRef([...Array(18)].map(() => new Animated.Value(0.2))).current;
  useEffect(() => {
    if (!playing) { vals.forEach((v) => v.setValue(0.2)); return; }
    const loops = vals.map((v, i) => {
      const l = Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 0.25 + Math.random() * 0.75, duration: 350 + i * 25, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.15, duration: 350 + i * 25, useNativeDriver: true }),
      ]));
      l.start();
      return l;
    });
    return () => loops.forEach((l) => l.stop());
  }, [playing]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', height: 44, marginVertical: 14 }}>
      {vals.map((v, i) => (
        <Animated.View key={i} style={{ width: 5, height: 44, marginHorizontal: 2, borderRadius: 3, backgroundColor: i % 3 ? C.red : C.crim, transform: [{ scaleY: v }] }} />
      ))}
    </View>
  );
};

/* ============================== SCREENS ============================== */
function Home({ a }) {
  const most = useMemo(() => {
    const all = [...a.data.recent, ...a.data.fav, ...a.local.slice(0, 200)];
    const seen = {};
    return all.filter((t) => (seen[t.id] ? false : (seen[t.id] = true)) && a.data.plays[t.id])
      .sort((x, y) => a.data.plays[y.id] - a.data.plays[x.id]).slice(0, 15);
  }, [a.data, a.local]);
  const added = useMemo(() => a.local.slice(-15).reverse(), [a.local]);
  return (
    <FlatList data={[1]} keyExtractor={() => 'h'} contentContainerStyle={{ padding: 16, paddingBottom: 150 }}
      renderItem={() => (
        <View>
          <Hero title="A1" sub="Dark. Cinematic. Yours." onPlay={() => { const l = a.data.recent.length ? a.data.recent : a.local; l.length ? a.playAt(l, 0) : a.setTab('Library'); }} />
          <TouchableOpacity style={s.search} onPress={() => a.setTab('Search')}>
            <Ionicons name="search" size={18} color={C.silver} />
            <Text style={{ color: C.silver, marginLeft: 10 }}>Search songs or YouTube…</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', marginTop: 16 }}>
            <Btn icon="folder-open" label="Local Music" onPress={() => a.setTab('Library')} style={{ flex: 1, marginRight: 8 }} />
            <Btn icon="cloud" label="Online Audio" onPress={() => a.setTab('Online')} style={{ flex: 1, marginLeft: 8 }} />
          </View>
          <Section title="Recently Played" data={a.data.recent} onPlay={a.playAt} emptyText="Nothing played yet." />
          <Section title="Recently Added" data={added} onPlay={a.playAt} emptyText="Scan your device in Library to see songs." />
          <Section title="Most Played" data={most} onPlay={a.playAt} emptyText="Play some songs first." />
          <Section title="Favorites" data={a.data.fav} onPlay={a.playAt} emptyText="Tap the heart in the player." />
          <View style={{ marginTop: 22 }}>
            <Text style={s.h2}>Playlists</Text>
            {a.data.playlists.length === 0 ? <Text style={s.emptyInline}>No playlists yet (Library → Playlists).</Text> :
              a.data.playlists.map((p) => <Text key={p.id} style={s.rowS}>• {p.name} ({p.tracks.length})</Text>)}
          </View>
          <View style={{ marginTop: 22 }}>
            <Text style={s.h2}>YouTube</Text>
            <Btn icon="logo-youtube" label="Open YouTube search" onPress={() => a.setTab('Search')} />
          </View>
          <Text style={{ color: '#6d6d78', textAlign: 'center', marginTop: 30, fontSize: 12 }}>Developed by Azim R</Text>
        </View>
      )} />
  );
}

function Library({ a }) {
  const [mode, setMode] = useState('songs');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('title');
  const [openPl, setOpenPl] = useState(null);
  const list = useMemo(() => {
    let l = a.local.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()));
    l = [...l].sort((x, y) => (sort === 'title' ? x.title.localeCompare(y.title) : (y.duration || 0) - (x.duration || 0)));
    return l;
  }, [a.local, q, sort]);
  const favIds = useMemo(() => new Set(a.data.fav.map((f) => f.id)), [a.data.fav]);
  const renderT = ({ item, index }, arr) => (
    <TrackRow t={item} active={a.cur && a.cur.id === item.id} fav={favIds.has(item.id)}
      onPress={() => a.playAt(arr, index)} onMore={() => a.setPicker(item)} />
  );
  const pl = a.data.playlists.find((p) => p.id === openPl);
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12 }}>
        {['songs', 'favorites', 'playlists'].map((m) => (
          <TouchableOpacity key={m} onPress={() => { setMode(m); setOpenPl(null); }} style={[s.chip, mode === m && s.chipOn]}>
            <Text style={{ color: C.white, textTransform: 'capitalize' }}>{m}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {mode === 'songs' && (
        <FlatList data={list} keyExtractor={(x) => x.id} contentContainerStyle={{ padding: 16, paddingBottom: 150 }}
          initialNumToRender={12} windowSize={7} removeClippedSubviews
          ListHeaderComponent={(
            <View>
              <Hero title="Your Music" sub={a.local.length + ' songs on this device'} onPlay={() => list.length && a.playAt(list, 0)} />
              <View style={{ flexDirection: 'row', marginBottom: 10 }}>
                <Btn icon="scan" label="Scan device" onPress={a.scan} style={{ flex: 1, marginRight: 8 }} />
                <Btn icon="document" label="Pick files" onPress={a.pick} style={{ flex: 1, marginLeft: 8 }} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                <TextInput value={q} onChangeText={setQ} placeholder="Filter songs" placeholderTextColor="#777" style={[s.input, { flex: 1 }]} />
                <TouchableOpacity onPress={() => setSort(sort === 'title' ? 'duration' : 'title')} style={{ marginLeft: 10 }}>
                  <Text style={{ color: C.crim }}>Sort: {sort}</Text>
                </TouchableOpacity>
              </View>
              {a.scanning ? <ActivityIndicator color={C.crim} style={{ marginVertical: 10 }} /> : null}
              <Text style={s.h2}>Top Songs</Text>
            </View>
          )}
          renderItem={(i) => renderT(i, list)}
          ListEmptyComponent={<Empty text="No local songs" sub={a.perm === 'denied' ? 'Audio permission denied. Allow it in Settings or use Pick files.' : 'Tap Scan device or Pick files.'} />} />
      )}
      {mode === 'favorites' && (
        <FlatList data={a.data.fav} keyExtractor={(x) => x.id} contentContainerStyle={{ padding: 16, paddingBottom: 150 }}
          renderItem={(i) => renderT(i, a.data.fav)} ListEmptyComponent={<Empty icon="heart-outline" text="No favorites yet" />} />
      )}
      {mode === 'playlists' && !pl && (
        <FlatList data={a.data.playlists} keyExtractor={(x) => x.id} contentContainerStyle={{ padding: 16, paddingBottom: 150 }}
          ListHeaderComponent={<Btn icon="add" label="New playlist" onPress={() => a.setPicker({ newOnly: true })} style={{ marginBottom: 12 }} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={s.row} onPress={() => setOpenPl(item.id)}>
              <Ionicons name="albums" size={26} color={C.crim} />
              <Text style={[s.rowT, { flex: 1, marginLeft: 12 }]}>{item.name} ({item.tracks.length})</Text>
              <TouchableOpacity onPress={() => Alert.alert('Delete playlist?', 'Songs on your device are NOT deleted.', [
                { text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: () => a.setData((d) => ({ ...d, playlists: d.playlists.filter((p) => p.id !== item.id) })) }])}>
                <Ionicons name="trash-outline" size={20} color={C.silver} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Empty icon="albums-outline" text="No playlists" />} />
      )}
      {mode === 'playlists' && pl && (
        <FlatList data={pl.tracks} keyExtractor={(x) => x.id} contentContainerStyle={{ padding: 16, paddingBottom: 150 }}
          ListHeaderComponent={<Text style={s.h2}>{pl.name}</Text>}
          renderItem={({ item, index }) => (
            <TrackRow t={item} active={a.cur && a.cur.id === item.id} fav={favIds.has(item.id)}
              onPress={() => a.playAt(pl.tracks, index)}
              onMore={() => Alert.alert(item.title, 'Remove from this playlist? (file stays on device)', [{ text: 'Cancel' },
                { text: 'Remove', onPress: () => a.setData((d) => ({ ...d, playlists: d.playlists.map((p) => p.id === pl.id ? { ...p, tracks: p.tracks.filter((x) => x.id !== item.id) } : p) })) }])} />
          )}
          ListEmptyComponent={<Empty text="Empty playlist" sub="Use ⋮ on a song to add it here." />} />
      )}
    </View>
  );
}

function SearchTab({ a }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    if (!q.trim()) return;
    if (!a.data.ytKey) { setErr('NO_KEY'); return; }
    if (!a.online) { setErr('You are offline.'); return; }
    setBusy(true); setErr('');
    try {
      const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=20&q=' +
        encodeURIComponent(q) + '&key=' + encodeURIComponent(a.data.ytKey);
      const r = await fetch(url);
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'API error');
      setRes((j.items || []).map((i) => ({ id: i.id.videoId, title: i.snippet.title, channel: i.snippet.channelTitle, thumb: i.snippet.thumbnails && i.snippet.thumbnails.medium && i.snippet.thumbnails.medium.url })));
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };
  const localRes = useMemo(() => (q.length > 1 ? a.local.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : []), [q, a.local]);
  return (
    <View style={{ flex: 1 }}>
      <Text style={[s.title, { padding: 16, paddingBottom: 6 }]}>Search</Text>
      <View style={{ flexDirection: 'row', paddingHorizontal: 16 }}>
        <TextInput value={q} onChangeText={setQ} onSubmitEditing={go} returnKeyType="search" placeholder="Songs, or YouTube videos" placeholderTextColor="#777" style={[s.input, { flex: 1 }]} />
        <TouchableOpacity onPress={go} style={s.go}><Ionicons name="logo-youtube" size={20} color={C.white} /></TouchableOpacity>
      </View>
      {err === 'NO_KEY' ? (
        <Empty icon="key-outline" text="YouTube API key needed" sub="Settings → YouTube API key. Create a free key in Google Cloud Console (YouTube Data API v3) and restrict it to this Android app." />
      ) : err ? <Text style={[s.emptyInline, { padding: 16 }]}>{err}</Text> : null}
      {busy ? <ActivityIndicator color={C.crim} style={{ marginTop: 20 }} /> : null}
      <FlatList data={res} keyExtractor={(x) => x.id} contentContainerStyle={{ padding: 16, paddingBottom: 150 }}
        ListHeaderComponent={localRes.length ? (
          <View>
            <Text style={s.h2}>On this device</Text>
            {localRes.map((t, i) => <TrackRow key={t.id} t={t} onPress={() => a.playAt(localRes, i)} onMore={() => a.setPicker(t)} />)}
            <Text style={[s.h2, { marginTop: 14 }]}>YouTube</Text>
          </View>) : null}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.row} onPress={() => a.openYT(item)}>
            <Image source={{ uri: item.thumb }} style={{ width: 96, height: 54, borderRadius: 8, backgroundColor: C.burg }} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text numberOfLines={2} style={s.rowT}>{item.title}</Text>
              <Text numberOfLines={1} style={s.rowS}>{item.channel}</Text>
            </View>
          </TouchableOpacity>
        )} />
    </View>
  );
}

function Online({ a }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const search = async () => {
    if (!q.trim()) return;
    if (!a.online) { setErr('You are offline.'); return; }
    setBusy(true); setErr('');
    try {
      const query = encodeURIComponent('(' + q + ') AND mediatype:audio');
      const url = 'https://archive.org/advancedsearch.php?q=' + query + '&fl[]=identifier&fl[]=title&fl[]=creator&rows=25&output=json';
      const j = await (await fetch(url)).json();
      setRes(j.response.docs || []);
    } catch (e) { setErr('Search failed: ' + (e.message || e)); }
    setBusy(false);
  };
  const open = async (it) => {
    setBusy(true); setErr('');
    try {
      const m = await (await fetch('https://archive.org/metadata/' + it.identifier)).json();
      const files = (m.files || []).filter((f) => /\.mp3$/i.test(f.name));
      if (!files.length) throw new Error('No MP3 stream in this item.');
      const art = 'https://archive.org/services/img/' + it.identifier;
      const tracks = files.map((f) => ({
        id: 'ia:' + it.identifier + '/' + f.name, title: f.title || cleanName(f.name),
        artist: (Array.isArray(it.creator) ? it.creator[0] : it.creator) || 'Internet Archive',
        uri: 'https://archive.org/download/' + it.identifier + '/' + encodeURIComponent(f.name),
        duration: parseFloat(f.length) || 0, src: 'online', art,
      }));
      a.playAt(tracks, 0);
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };
  return (
    <View style={{ flex: 1 }}>
      <Text style={[s.title, { padding: 16, paddingBottom: 6 }]}>Online</Text>
      <Text style={[s.rowS, { paddingHorizontal: 16 }]}>Provider: Internet Archive audio (free, public). Content licenses vary per item.</Text>
      <View style={{ flexDirection: 'row', padding: 16 }}>
        <TextInput value={q} onChangeText={setQ} onSubmitEditing={search} returnKeyType="search" placeholder="Search free audio" placeholderTextColor="#777" style={[s.input, { flex: 1 }]} />
        <TouchableOpacity onPress={search} style={s.go}><Ionicons name="search" size={20} color={C.white} /></TouchableOpacity>
      </View>
      {!a.online ? <Empty icon="cloud-offline-outline" text="You're offline" sub="Online audio needs internet. Local music still works." /> : null}
      {err ? <Text style={[s.emptyInline, { paddingHorizontal: 16 }]}>{err}</Text> : null}
      {busy ? <ActivityIndicator color={C.crim} style={{ marginTop: 10 }} /> : null}
      <FlatList data={res} keyExtractor={(x) => x.identifier} contentContainerStyle={{ padding: 16, paddingBottom: 150 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.row} onPress={() => open(item)}>
            <Ionicons name="play-circle" size={30} color={C.crim} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text numberOfLines={1} style={s.rowT}>{item.title}</Text>
              <Text numberOfLines={1} style={s.rowS}>{Array.isArray(item.creator) ? item.creator[0] : item.creator || 'Unknown'}</Text>
            </View>
          </TouchableOpacity>
        )} />
    </View>
  );
}

function Settings({ a }) {
  const [key, setKey] = useState(a.data.ytKey);
  return (
    <FlatList data={[1]} keyExtractor={() => 's'} contentContainerStyle={{ padding: 16, paddingBottom: 150 }}
      renderItem={() => (
        <View>
          <Text style={s.title}>Settings</Text>
          <View style={s.dev}>
            <Image source={require('./assets/azim.jpg')} style={s.devImg} />
            <View style={{ marginLeft: 16, flex: 1 }}>
              <Text style={s.rowS}>Developed by</Text>
              <Text style={{ color: C.white, fontSize: 22, fontWeight: '800', marginTop: 2 }}>Azim R</Text>
              <Text style={[s.rowS, { color: C.crim }]}>A1 · v{VERSION}</Text>
            </View>
          </View>
          <Text style={s.h2}>Library permission</Text>
          <Text style={s.rowS}>Audio access: {a.perm}. A1 only asks for audio access and notifications.</Text>
          <Btn icon="shield-checkmark" label="Request audio permission" onPress={a.scan} style={{ marginTop: 8 }} />
          <Text style={[s.h2, { marginTop: 22 }]}>YouTube API key</Text>
          <Text style={s.rowS}>Use a PUBLIC key restricted to YouTube Data API v3 and to this Android app. Never put secret/OAuth client secrets here.</Text>
          <TextInput value={key} onChangeText={setKey} placeholder="AIza…" placeholderTextColor="#777" style={[s.input, { marginTop: 8 }]} autoCapitalize="none" />
          <Btn icon="save" label="Save key" onPress={() => { a.setData((d) => ({ ...d, ytKey: key.trim() })); Alert.alert('Saved'); }} style={{ marginTop: 8 }} />
          <Text style={[s.h2, { marginTop: 22 }]}>Data</Text>
          <Btn icon="trash" label="Clear Recently Played" onPress={() => a.setData((d) => ({ ...d, recent: [], plays: {} }))} />
          <Text style={[s.h2, { marginTop: 22 }]}>About A1</Text>
          <Text style={s.rowS}>Version {VERSION}. Theme: Obsidian / Blood-red horror (fixed).{'\n'}
            Local + Internet Archive audio play in the background with a notification (play/pause/seek). YouTube plays in the official YouTube player, in the foreground only — YouTube's terms do not allow audio-only/background playback through embeds.</Text>
          <Text style={[s.h2, { marginTop: 22 }]}>Privacy</Text>
          <Text style={s.rowS}>No accounts, no ads, no analytics. Favorites, playlists and history stay on this phone. Network is used only for the sources you search (Internet Archive, YouTube).</Text>
        </View>
      )} />
  );
}

/* ============================== NOW PLAYING ============================== */
function NowPlaying({ a }) {
  const ins = useSafeAreaInsets();
  const t = a.cur;
  const [w, setW] = useState(1);
  const [showQ, setShowQ] = useState(false);
  if (!t) return null;
  const dur = a.status.duration || t.duration || 0;
  const pos = a.status.currentTime || 0;
  const isFav = a.data.fav.some((f) => f.id === t.id);
  const pct = dur ? Math.min(1, pos / dur) : 0;
  return (
    <Modal visible={a.showNP} animationType="slide" onRequestClose={() => a.setShowNP(false)}>
      <LinearGradient colors={['#1d1d22', '#0e0e11', '#07070A']} style={{ flex: 1, paddingTop: TOP, paddingHorizontal: 22, paddingBottom: ins.bottom + 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => a.setShowNP(false)} hitSlop={10}><Ionicons name="chevron-down" size={28} color={C.silver} /></TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: C.white, fontWeight: '700' }}>Now Playing</Text>
            <Text style={{ color: '#7b7b86', fontSize: 11 }}>{t.src === 'online' ? 'Internet Archive' : 'Local file'}</Text>
          </View>
          <TouchableOpacity onPress={() => setShowQ(!showQ)} hitSlop={10}><Ionicons name={showQ ? 'disc' : 'list'} size={24} color={C.silver} /></TouchableOpacity>
        </View>
        {showQ ? (
          <FlatList data={a.queue} keyExtractor={(x, i) => x.id + i} style={{ marginTop: 16 }}
            renderItem={({ item, index }) => (
              <TouchableOpacity style={[s.row, index === a.idx && { borderColor: C.crim }]} onPress={() => a.playAt(a.queue, index)}>
                <Text numberOfLines={1} style={[s.rowT, { flex: 1 }]}>{item.title}</Text>
                <TouchableOpacity onPress={() => a.removeFromQueue(index)}><Ionicons name="close" size={20} color={C.silver} /></TouchableOpacity>
              </TouchableOpacity>
            )} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Disc track={t} playing={!!a.status.playing} size={250} />
          </View>
        )}
        {a.error ? <Text style={{ color: C.crim, textAlign: 'center', marginBottom: 6 }}>{a.error}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: C.white, fontSize: 24, fontWeight: '800' }}>{t.title}</Text>
            <Text numberOfLines={1} style={{ color: '#7b7b86', marginTop: 3 }}>{t.artist}</Text>
          </View>
          <TouchableOpacity onPress={() => a.setPicker(t)} style={{ marginRight: 16 }}><Ionicons name="add-circle-outline" size={26} color={C.silver} /></TouchableOpacity>
          <TouchableOpacity onPress={() => a.toggleFav(t)}><Ionicons name={isFav ? 'heart' : 'heart-outline'} size={26} color={isFav ? C.crim : C.silver} /></TouchableOpacity>
        </View>
        <Pressable onLayout={(e) => setW(e.nativeEvent.layout.width || 1)} style={{ height: 28, justifyContent: 'center', marginTop: 18 }}
          onPress={(e) => dur && a.player.seekTo((e.nativeEvent.locationX / w) * dur)}>
          <View style={{ height: 3, backgroundColor: '#3a3a42', borderRadius: 2 }}>
            <View style={{ height: 3, width: pct * w, backgroundColor: C.crim, borderRadius: 2 }} />
          </View>
          <View style={{ position: 'absolute', left: Math.max(0, pct * w - 6), width: 12, height: 12, borderRadius: 6, backgroundColor: C.crim }} />
        </Pressable>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={s.time}>{fmt(pos)}</Text><Text style={s.time}>{fmt(dur)}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 34 }}>
          <TouchableOpacity onPress={() => a.setRepeat(a.repeat === 'off' ? 'all' : a.repeat === 'all' ? 'one' : 'off')}>
            <Ionicons name="repeat" size={24} color={a.repeat === 'off' ? '#6d6d78' : C.crim} />
            {a.repeat === 'one' ? <Text style={{ color: C.crim, position: 'absolute', right: -5, top: -5, fontSize: 11, fontWeight: '800' }}>1</Text> : null}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => a.step(-1)}><Ionicons name="play-skip-back" size={30} color={C.silver} /></TouchableOpacity>
          <TouchableOpacity onPress={a.toggle} style={s.big} activeOpacity={0.85}>
            <Ionicons name={a.status.playing ? 'pause' : 'play'} size={30} color={C.white} style={a.status.playing ? null : { marginLeft: 3 }} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => a.step(1)}><Ionicons name="play-skip-forward" size={30} color={C.silver} /></TouchableOpacity>
          <TouchableOpacity onPress={() => a.setShuffle(!a.shuffle)}><Ionicons name="shuffle" size={24} color={a.shuffle ? C.crim : '#6d6d78'} /></TouchableOpacity>
        </View>
      </LinearGradient>
    </Modal>
  );
}

function MiniPlayer({ a }) {
  const t = a.cur;
  if (!t) return null;
  const dur = a.status.duration || t.duration || 1;
  return (
    <TouchableOpacity activeOpacity={0.92} onPress={() => a.setShowNP(true)} style={s.mini}>
      <TouchableOpacity onPress={a.toggle} hitSlop={8}>
        <Ring size={46} progress={(a.status.currentTime || 0) / dur}>
          <Ionicons name={a.status.playing ? 'pause' : 'play'} size={20} color={C.white} />
        </Ring>
      </TouchableOpacity>
      <View style={{ flex: 1, marginHorizontal: 12 }}>
        <Text numberOfLines={1} style={s.rowT}>{t.title}</Text>
        <Text numberOfLines={1} style={s.rowS}>{t.artist}</Text>
      </View>
      <TouchableOpacity onPress={() => a.step(1)} hitSlop={8} style={{ marginRight: 10 }}><Ionicons name="play-skip-forward" size={22} color={C.silver} /></TouchableOpacity>
      <View style={{ borderRadius: 28, borderWidth: 2, borderColor: C.red, padding: 1, shadowColor: C.crim, elevation: 10 }}>
        <Art track={t} size={46} round />
      </View>
    </TouchableOpacity>
  );
}

/* ============================== APP ROOT ============================== */
function Main() {
  const ins = useSafeAreaInsets();
  const [tab, setTab] = useState('Home');
  const [data, setData] = useState(DEFAULT_DATA);
  const [loaded, setLoaded] = useState(false);
  const [local, setLocal] = useState([]);
  const [perm, setPerm] = useState('unknown');
  const [scanning, setScanning] = useState(false);
  const [online, setOnline] = useState(true);
  const [player] = useState(() => createAudioPlayer(null));
  const status = useAudioPlayerStatus(player);
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(-1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [showNP, setShowNP] = useState(false);
  const [yt, setYt] = useState(null);
  const [picker, setPicker] = useState(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const cur = queue[idx];
  const R = useRef({});
  R.current = { queue, idx, shuffle, repeat, showNP, yt, picker, tab };

  // init
  useEffect(() => {
    (async () => {
      try { const raw = await AsyncStorage.getItem(STORE); if (raw) setData({ ...DEFAULT_DATA, ...JSON.parse(raw) }); } catch (e) {}
      setLoaded(true);
      try {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix', interruptionModeAndroid: 'doNotMix' });
      } catch (e) {}
    })();
    const unsub = NetInfo.addEventListener((st) => setOnline(st.isConnected !== false));
    return () => { unsub(); try { player.clearLockScreenControls(); player.remove(); } catch (e) {} };
  }, []);
  useEffect(() => { if (loaded) AsyncStorage.setItem(STORE, JSON.stringify(data)).catch(() => {}); }, [data, loaded]);

  const playAt = useCallback((list, i) => {
    const t = list[i];
    if (!t) return;
    setYt(null); setQueue(list); setIdx(i); setError('');
    try {
      player.replace({ uri: t.uri });
      player.play();
    } catch (e) { setError('Cannot play this file (missing or unsupported format).'); }
    try {
      player.setActiveForLockScreen(true,
        { title: t.title, artist: t.artist, albumTitle: t.src === 'online' ? 'Internet Archive' : 'A1', artworkUrl: t.art },
        { showSeekBackward: true, showSeekForward: true });
    } catch (e) {}
    setData((d) => ({
      ...d,
      recent: [t, ...d.recent.filter((x) => x.id !== t.id)].slice(0, 30),
      plays: { ...d.plays, [t.id]: (d.plays[t.id] || 0) + 1 },
    }));
  }, [player]);

  const step = useCallback((dir, auto) => {
    const { queue: q, idx: i, shuffle: sh, repeat: rp } = R.current;
    if (!q.length) return;
    if (auto && rp === 'one') { player.seekTo(0); player.play(); return; }
    let n;
    if (sh && q.length > 1) { do { n = Math.floor(Math.random() * q.length); } while (n === i); }
    else {
      n = i + dir;
      if (n >= q.length) { if (rp === 'all' || !auto) n = 0; else { player.pause(); return; } }
      if (n < 0) n = q.length - 1;
    }
    playAt(q, n);
  }, [player, playAt]);

  useEffect(() => { if (status.didJustFinish) step(1, true); }, [status.didJustFinish]);

  const toggle = useCallback(() => { status.playing ? player.pause() : player.play(); }, [status.playing, player]);
  const toggleFav = useCallback((t) => setData((d) => ({ ...d, fav: d.fav.some((f) => f.id === t.id) ? d.fav.filter((f) => f.id !== t.id) : [t, ...d.fav] })), []);
  const removeFromQueue = useCallback((n) => {
    const { queue: q, idx: i } = R.current;
    if (q.length <= 1 || n === i) return;
    setQueue(q.filter((_, k) => k !== n));
    if (n < i) setIdx(i - 1);
  }, []);

  const openYT = useCallback((v) => { try { player.pause(); } catch (e) {} setYt(v); }, [player]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const p = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
      setPerm(p.granted ? 'granted' : 'denied');
      if (p.granted) {
        let all = [], after;
        for (let k = 0; k < 20; k++) {
          const r = await MediaLibrary.getAssetsAsync({ mediaType: 'audio', first: 300, after });
          all = all.concat(r.assets);
          if (!r.hasNextPage) break;
          after = r.endCursor;
        }
        setLocal((prev) => {
          const picked = prev.filter((t) => t.picked);
          return [...all.map((x) => ({ id: 'l:' + x.id, title: cleanName(x.filename), artist: 'Unknown artist', uri: x.uri, duration: x.duration, src: 'local' })), ...picked];
        });
      }
    } catch (e) { setPerm('error'); }
    setScanning(false);
  }, []);

  const pick = useCallback(async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: false });
      if (r.canceled) return;
      const add = r.assets.map((x) => ({ id: 'p:' + x.uri, title: cleanName(x.name), artist: 'Unknown artist', uri: x.uri, duration: 0, src: 'local', picked: true }));
      setLocal((prev) => [...prev, ...add.filter((n) => !prev.some((p) => p.id === n.id))]);
    } catch (e) { Alert.alert('Could not open files'); }
  }, []);

  // Android back button
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const r = R.current;
      if (r.picker) { setPicker(null); return true; }
      if (r.yt) { setYt(null); return true; }
      if (r.showNP) { setShowNP(false); return true; }
      if (r.tab !== 'Home') { setTab('Home'); return true; }
      Alert.alert('Leave A1?', 'Music keeps playing in the background if a song is active.', [
        { text: 'Stay' }, { text: 'Exit', style: 'destructive', onPress: () => BackHandler.exitApp() }]);
      return true;
    });
    return () => sub.remove();
  }, []);

  const addToPlaylist = (pid) => {
    setData((d) => ({ ...d, playlists: d.playlists.map((p) => p.id === pid && !p.tracks.some((x) => x.id === picker.id) ? { ...p, tracks: [...p.tracks, picker] } : p) }));
    setPicker(null);
  };
  const createPlaylist = () => {
    if (!newName.trim()) return;
    const id = 'pl' + Date.now();
    setData((d) => ({ ...d, playlists: [...d.playlists, { id, name: newName.trim(), tracks: picker && !picker.newOnly ? [picker] : [] }] }));
    setNewName(''); setPicker(null);
  };

  const a = { data, setData, local, perm, scanning, online, player, status, queue, idx, cur, shuffle, setShuffle, repeat, setRepeat,
    showNP, setShowNP, playAt, step, toggle, toggleFav, removeFromQueue, openYT, scan, pick, setTab, setPicker, error };

  const tabs = [['Home', 'home'], ['Search', 'search'], ['Library', 'library'], ['Online', 'cloud'], ['Settings', 'settings']];

  if (!loaded) return <View style={[s.root, { justifyContent: 'center' }]}><ActivityIndicator color={C.crim} size="large" /></View>;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={{ flex: 1, paddingTop: TOP }}>
        {!online ? <Text style={s.offline}>Offline — local music still works</Text> : null}
        {tab === 'Home' && <Home a={a} />}
        {tab === 'Search' && <SearchTab a={a} />}
        {tab === 'Library' && <Library a={a} />}
        {tab === 'Online' && <Online a={a} />}
        {tab === 'Settings' && <Settings a={a} />}
      </View>
      <MiniPlayer a={a} />
      <View style={[s.nav, { paddingBottom: ins.bottom + 12, paddingTop: 10 }]}>
        {tabs.map(([n, ic]) => (
          <TouchableOpacity key={n} style={{ flex: 1, alignItems: 'center' }} onPress={() => setTab(n)}>
            <Ionicons name={tab === n ? ic : ic + '-outline'} size={22} color={tab === n ? C.crim : C.silver} />
            <Text style={{ fontSize: 10, color: tab === n ? C.crim : C.silver, marginTop: 2 }}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <NowPlaying a={a} />

      {/* YouTube: official embedded player, foreground only */}
      <Modal visible={!!yt} animationType="slide" onRequestClose={() => setYt(null)}>
        <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: TOP }}>
          <TouchableOpacity onPress={() => setYt(null)} style={{ padding: 14 }}><Ionicons name="close" size={28} color={C.white} /></TouchableOpacity>
          {yt ? (
            <View>
              <View style={{ height: 230 }}>
                <WebView
                  originWhitelist={['*']}
                  allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} javaScriptEnabled allowsFullscreenVideo
                  source={{ baseUrl: 'https://www.youtube.com', html: '<html><body style="margin:0;background:#000"><iframe width="100%" height="100%" src="https://www.youtube.com/embed/' + yt.id + '?playsinline=1&autoplay=1&rel=0" frameborder="0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></body></html>' }}
                  style={{ backgroundColor: '#000' }} />
              </View>
              <Text style={[s.rowT, { padding: 16, fontSize: 16 }]}>{yt.title}</Text>
              <Text style={[s.rowS, { paddingHorizontal: 16 }]}>{yt.channel}</Text>
              <Text style={[s.rowS, { padding: 16 }]}>Plays in YouTube's official player. YouTube does not permit background/audio-only playback via embeds; for that use YouTube Premium in the YouTube app.</Text>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* Add-to-playlist / new-playlist sheet */}
      <Modal visible={!!picker} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <Pressable style={s.backdrop} onPress={() => setPicker(null)}>
          <Pressable style={[s.sheet, { paddingBottom: 18 + ins.bottom }]}>
            {picker && !picker.newOnly ? (
              <View>
                <Text style={s.h2}>{picker.title}</Text>
                <Btn icon={data.fav.some((f) => f.id === picker.id) ? 'heart-dislike' : 'heart'} label="Toggle favorite" onPress={() => { toggleFav(picker); setPicker(null); }} style={{ marginBottom: 8 }} />
                <Btn icon="list" label="Play next (add to queue)" onPress={() => { setQueue((q) => { const i = R.current.idx; const c = [...q]; c.splice(i + 1, 0, picker); return c; }); setPicker(null); }} style={{ marginBottom: 8 }} />
                {data.playlists.map((p) => (
                  <TouchableOpacity key={p.id} onPress={() => addToPlaylist(p.id)} style={s.row}><Ionicons name="albums" size={20} color={C.crim} /><Text style={[s.rowT, { marginLeft: 10 }]}>{p.name}</Text></TouchableOpacity>
                ))}
              </View>
            ) : null}
            <Text style={[s.rowS, { marginTop: 8 }]}>New playlist</Text>
            <View style={{ flexDirection: 'row', marginTop: 6 }}>
              <TextInput value={newName} onChangeText={setNewName} placeholder="Name" placeholderTextColor="#777" style={[s.input, { flex: 1 }]} />
              <TouchableOpacity onPress={createPlaylist} style={s.go}><Ionicons name="checkmark" size={22} color={C.white} /></TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

/* ============================== STYLES ============================== */
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  title: { color: C.white, fontSize: 30, fontWeight: '800', letterSpacing: 2 },
  sub: { color: C.silver, marginTop: 2, marginBottom: 14 },
  h2: { color: C.white, fontSize: 18, fontWeight: '700', marginBottom: 10 },
  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.burg },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.red, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12 },
  btnT: { color: C.white, fontWeight: '700', marginLeft: 8 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, padding: 10, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: 'transparent' },
  rowT: { color: C.white, fontWeight: '600' },
  rowS: { color: C.silver, fontSize: 12, marginTop: 2 },
  card: { width: 130, marginRight: 12 },
  cardT: { color: C.white, marginTop: 6, fontWeight: '600' },
  cardS: { color: C.silver, fontSize: 12 },
  input: { backgroundColor: C.card, color: C.white, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.burg },
  go: { backgroundColor: C.red, marginLeft: 8, width: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: C.card, marginRight: 8, borderWidth: 1, borderColor: C.burg },
  chipOn: { backgroundColor: C.red, borderColor: C.crim },
  empty: { alignItems: 'center', padding: 30 },
  emptyT: { color: C.white, fontSize: 16, fontWeight: '700', marginTop: 10 },
  emptyS: { color: C.silver, textAlign: 'center', marginTop: 6 },
  emptyInline: { color: '#8a8a95' },
  nav: { flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.burg },
  dev: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 20, padding: 16, marginTop: 16, marginBottom: 6, borderWidth: 1, borderColor: C.burg },
  devImg: { width: 84, height: 84, borderRadius: 42, borderWidth: 2, borderColor: C.crim },
  mini: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#17171c', marginHorizontal: 10, marginBottom: 6, padding: 10, borderRadius: 26, borderWidth: 1, borderColor: '#2a1016' },
  big: { width: 70, height: 70, borderRadius: 35, backgroundColor: C.crim, alignItems: 'center', justifyContent: 'center', shadowColor: C.crim, shadowOpacity: 1, shadowRadius: 18, elevation: 22 },
  time: { color: '#7b7b86', fontSize: 11 },
  hero: { height: 190, borderRadius: 26, padding: 20, justifyContent: 'flex-end', overflow: 'hidden' },
  heroT: { color: C.white, fontSize: 32, fontWeight: '800' },
  heroS: { color: '#ffffffb0', marginTop: 2, marginBottom: 14 },
  heroPlay: { position: 'absolute', bottom: -30, left: '50%', marginLeft: -30, width: 60, height: 60, borderRadius: 30, backgroundColor: C.crim, alignItems: 'center', justifyContent: 'center', shadowColor: C.crim, shadowOpacity: 1, shadowRadius: 16, elevation: 20 },
  offline: { backgroundColor: C.burg, color: C.white, textAlign: 'center', padding: 4, fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: '#000a', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.bg, padding: 18, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: C.burg, maxHeight: '80%' },
});
