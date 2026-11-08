import Slider from '@react-native-community/slider';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PlaybackNotificationManager } from 'react-native-audio-api';

import { BANDS, Engine, PRESETS } from './engine';

type Track = { id: string; title: string; channel?: string; duration?: number };
type Playlist = { id: string; title: string; count?: number };

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const bandLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`);

export default function App() {
  const engineRef = useRef<Engine | null>(null);
  if (!engineRef.current) engineRef.current = new Engine();
  const eng = engineRef.current;

  const [server, setServer] = useState('');
  const [key, setKey] = useState('');
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [index, setIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [gains, setGains] = useState<number[]>(PRESETS.Flat);
  const [autoPre, setAutoPre] = useState(true);

  // Refs so notification callbacks always see the latest values.
  const tracksRef = useRef<Track[]>([]);
  const indexRef = useRef(-1);
  tracksRef.current = tracks;
  indexRef.current = index;

  // Restore saved settings.
  useEffect(() => {
    (async () => {
      setServer((await SecureStore.getItemAsync('server')) ?? '');
      setKey((await SecureStore.getItemAsync('key')) ?? '');
      const g = await SecureStore.getItemAsync('gains');
      if (g) setGains(JSON.parse(g));
      const a = await SecureStore.getItemAsync('autoPre');
      if (a) setAutoPre(a === '1');
    })();
  }, []);

  // Apply + persist EQ whenever it changes.
  useEffect(() => {
    eng.setGains(gains, autoPre);
    SecureStore.setItemAsync('gains', JSON.stringify(gains));
    SecureStore.setItemAsync('autoPre', autoPre ? '1' : '0');
  }, [gains, autoPre, eng]);

  const base = server.replace(/\/+$/, '');

  const showNotification = (t: Track, isPlaying: boolean) =>
    PlaybackNotificationManager.show({
      title: t.title,
      artist: t.channel,
      duration: eng.duration,
      elapsedTime: eng.position(),
      state: isPlaying ? 'playing' : 'paused',
    }).catch(() => {});

  const playIndex = async (i: number) => {
    const t = tracksRef.current[i];
    if (!t) return;
    setIndex(i);
    setLoading(true);
    setStatus('Yükleniyor…');
    try {
      await eng.load(`${base}/api/stream/${t.id}?key=${encodeURIComponent(key)}`);
      await eng.play();
      setPlaying(true);
      setStatus('');
      showNotification(t, true);
    } catch (e) {
      setPlaying(false);
      setStatus(`Hata: ${String(e).slice(0, 120)}`);
    } finally {
      setLoading(false);
    }
  };

  const togglePlay = async () => {
    const t = tracksRef.current[indexRef.current];
    if (!t) return;
    if (eng.playing) {
      eng.pause();
      setPlaying(false);
    } else {
      await eng.play();
      setPlaying(true);
    }
    showNotification(t, eng.playing);
  };

  const next = () => {
    const i = indexRef.current + 1;
    if (i < tracksRef.current.length) playIndex(i);
    else {
      eng.pause();
      setPlaying(false);
    }
  };
  const prev = () => playIndex(Math.max(0, indexRef.current - 1));

  // GET a JSON endpoint on the server; `path` may already contain a query.
  const getJson = async (path: string, busy: string) => {
    if (!base || !key) {
      setStatus('Önce sunucu adresi ve anahtarı gir (en altta).');
      return null;
    }
    setStatus(busy);
    try {
      const sep = path.includes('?') ? '&' : '?';
      const r = await fetch(`${base}${path}${sep}key=${encodeURIComponent(key)}`);
      if (r.status === 503) throw new Error('Sunucuda YouTube Music girişi kurulu değil');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setStatus('');
      return data;
    } catch (e) {
      setStatus(`Hata: ${String(e).slice(0, 120)}`);
      return null;
    }
  };

  const search = async () => {
    const data = await getJson(`/api/search?q=${encodeURIComponent(query)}`, 'Aranıyor…');
    if (data) setTracks(data);
  };

  const loadLiked = async () => {
    const data = await getJson('/api/library/liked', 'Beğendiklerin yükleniyor…');
    if (data) setTracks(data);
  };

  const loadPlaylists = async () => {
    const data = await getJson('/api/library/playlists', 'Listeler yükleniyor…');
    if (data) setPlaylists(data);
  };

  const openPlaylist = async (id: string) => {
    const data = await getJson(`/api/library/playlist/${id}`, 'Liste açılıyor…');
    if (data) setTracks(data);
  };

  // Progress ticker + auto-advance.
  useEffect(() => {
    const id = setInterval(() => {
      const p = eng.position();
      setPos(p);
      setDur(eng.duration);
      if (eng.playing && eng.duration > 0 && p >= eng.duration - 0.25) next();
    }, 500);
    return () => clearInterval(id);
  }, [eng]);

  // Lock screen / Control Center buttons.
  useEffect(() => {
    const m = PlaybackNotificationManager;
    const subs = [
      m.addEventListener('playbackNotificationPlay', () => togglePlay()),
      m.addEventListener('playbackNotificationPause', () => togglePlay()),
      m.addEventListener('playbackNotificationNextTrack', () => next()),
      m.addEventListener('playbackNotificationPreviousTrack', () => prev()),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  const current = tracks[index];

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <StatusBar style="light" />

      <Text style={s.h}>Şimdi çalıyor</Text>
      <View style={s.card}>
        <Text style={s.title} numberOfLines={2}>
          {current ? current.title : '—'}
        </Text>
        <Slider
          minimumValue={0}
          maximumValue={Math.max(dur, 1)}
          value={pos}
          onSlidingComplete={(v) => eng.seek(v)}
          minimumTrackTintColor="#4ade80"
        />
        <View style={s.row}>
          <Text style={s.dim}>{fmt(pos)}</Text>
          <Text style={s.dim}>{fmt(dur)}</Text>
        </View>
        <View style={s.row}>
          <Pressable style={s.btnGhost} onPress={prev}>
            <Text style={s.btnText}>⏮</Text>
          </Pressable>
          <Pressable style={s.btn} onPress={togglePlay}>
            {loading ? (
              <ActivityIndicator color="#06210f" />
            ) : (
              <Text style={s.btnDark}>{playing ? '❚❚' : '▶︎'}</Text>
            )}
          </Pressable>
          <Pressable style={s.btnGhost} onPress={next}>
            <Text style={s.btnText}>⏭</Text>
          </Pressable>
        </View>
        {!!status && <Text style={s.dim}>{status}</Text>}
      </View>

      <Text style={s.h}>Kitaplığım</Text>
      <View style={s.row}>
        <Pressable style={s.btnGhost} onPress={loadLiked}>
          <Text style={s.btnText}>♥ Beğendiklerim</Text>
        </Pressable>
        <Pressable style={s.btnGhost} onPress={loadPlaylists}>
          <Text style={s.btnText}>☰ Çalma listeleri</Text>
        </Pressable>
      </View>
      {playlists.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {playlists.map((p) => (
            <Pressable key={p.id} style={s.chip} onPress={() => openPlaylist(p.id)}>
              <Text style={s.btnText}>{p.title}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Text style={s.h}>Ara</Text>
      <View style={s.row}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
          placeholder="Şarkı veya sanatçı"
          placeholderTextColor="#6b7280"
          returnKeyType="search"
        />
        <Pressable style={s.btn} onPress={search}>
          <Text style={s.btnDark}>Ara</Text>
        </Pressable>
      </View>
      {tracks.map((t, i) => (
        <Pressable key={t.id} style={s.item} onPress={() => playIndex(i)}>
          <Text style={[s.itemTitle, i === index && { color: '#4ade80' }]} numberOfLines={2}>
            {t.title}
          </Text>
          <Text style={s.dim}>
            {t.channel ?? ''} {t.duration ? `· ${fmt(t.duration)}` : ''}
          </Text>
        </Pressable>
      ))}

      <Text style={s.h}>Ekolayzır</Text>
      <View style={s.card}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {Object.keys(PRESETS).map((name) => (
            <Pressable key={name} style={s.chip} onPress={() => setGains(PRESETS[name])}>
              <Text style={s.btnText}>{name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {BANDS.map((hz, i) => (
          <View key={hz} style={s.band}>
            <Text style={s.dim}>{bandLabel(hz)}</Text>
            <Slider
              style={{ flex: 1 }}
              minimumValue={-12}
              maximumValue={12}
              step={0.5}
              value={gains[i]}
              onValueChange={(v) =>
                setGains((g) => g.map((x, j) => (j === i ? v : x)))
              }
              minimumTrackTintColor="#4ade80"
            />
            <Text style={[s.dim, { width: 44, textAlign: 'right' }]}>
              {gains[i] > 0 ? '+' : ''}
              {gains[i].toFixed(1)}
            </Text>
          </View>
        ))}
        <View style={s.row}>
          <Text style={s.btnText}>Otomatik preamp (cızırtıyı önler)</Text>
          <Switch value={autoPre} onValueChange={setAutoPre} />
        </View>
      </View>

      <Text style={s.h}>Ayarlar</Text>
      <View style={s.card}>
        <TextInput
          style={s.input}
          value={server}
          onChangeText={(v) => {
            setServer(v);
            SecureStore.setItemAsync('server', v);
          }}
          placeholder="Sunucu adresi (https://…)"
          placeholderTextColor="#6b7280"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={[s.input, { marginTop: 8 }]}
          value={key}
          onChangeText={(v) => {
            setKey(v);
            SecureStore.setItemAsync('key', v);
          }}
          placeholder="Sunucu anahtarı (EQ_TOKEN)"
          placeholderTextColor="#6b7280"
          secureTextEntry
          autoCapitalize="none"
        />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1115' },
  content: { padding: 14, paddingTop: 64, paddingBottom: 48 },
  h: { color: '#8b91a0', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginTop: 22, marginBottom: 8 },
  card: { backgroundColor: '#1a1d24', borderRadius: 14, padding: 12 },
  title: { color: '#e8eaf0', fontSize: 16, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 },
  dim: { color: '#8b91a0', fontSize: 13 },
  input: { backgroundColor: '#12151b', borderColor: '#2a2f3a', borderWidth: 1, borderRadius: 10, padding: 11, color: '#e8eaf0', fontSize: 16 },
  btn: { backgroundColor: '#4ade80', borderRadius: 10, paddingVertical: 11, paddingHorizontal: 18, minWidth: 64, alignItems: 'center' },
  btnGhost: { backgroundColor: '#262b36', borderRadius: 10, paddingVertical: 11, paddingHorizontal: 18, alignItems: 'center' },
  btnText: { color: '#e8eaf0', fontSize: 15 },
  btnDark: { color: '#06210f', fontSize: 16, fontWeight: '600' },
  chip: { backgroundColor: '#262b36', borderRadius: 16, paddingVertical: 7, paddingHorizontal: 14, marginRight: 8, marginBottom: 6 },
  item: { paddingVertical: 10, borderBottomColor: '#232834', borderBottomWidth: 1 },
  itemTitle: { color: '#e8eaf0', fontSize: 15 },
  band: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
