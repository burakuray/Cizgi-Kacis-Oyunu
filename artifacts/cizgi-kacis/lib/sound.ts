import { Audio, AVPlaybackSource } from 'expo-av';

export type SoundName = 'launch' | 'hit' | 'success' | 'portal';

const sources: Partial<Record<SoundName, AVPlaybackSource>> = {
  launch: require('../assets/audio/launch.wav'),
  hit: require('../assets/audio/hit.wav'),
  success: require('../assets/audio/success.wav'),
  portal: require('../assets/audio/portal.wav'),
};
let configured = false;
let enabled = true;

export function setSoundEnabled(value: boolean) {
  enabled = value;
}

async function configure() {
  if (configured) return;
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: true });
  configured = true;
}

export async function playSound(name: SoundName) {
  if (!enabled) return;
  const source = sources[name];
  if (!source) return;
  try {
    await configure();
    const { sound } = await Audio.Sound.createAsync(source, { shouldPlay: true, volume: 0.72 });
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) void sound.unloadAsync();
    });
  } catch {
  }
}
