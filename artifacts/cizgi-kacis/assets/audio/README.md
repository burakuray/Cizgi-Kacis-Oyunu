# Audio pack

The current WAV files are short effects downloaded from Google's Actions Sound Library and converted for Expo. Replace them with your own files if you want a more distinctive sound identity.

Place short, loop-free `.wav` or `.mp3` files here and register them in `lib/sound.ts`:

- `launch`: atış başlatma
- `hit`: bariyer çarpışması
- `success`: bölüm tamamlandı
- `portal`: geçit kullanımı

The sound manager is optional and fails silently when an asset is not available, so the game remains playable on web and native builds.
