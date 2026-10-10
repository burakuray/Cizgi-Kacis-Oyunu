# Dünya sıralaması (World leaderboard)

Oyuncular kendi telefonlarında oynar, puanları ortak bir sunucuda toplanır ve herkes kendi sırasını ile diğer
oyuncuların puan ve sıralamasını görür.

```
 Telefon (Expo oyunu)                      Sunucu (artifacts/api-server)            Veritabanı
 ─────────────────────                     ─────────────────────────────           ──────────
 Progress.levelScores ──► toplam puan ──►  PUT /api/players/me/score  ──►  players tablosu (Postgres)
 Sıralama ekranı      ◄── sıra + liste ◄── GET /api/leaderboard
```

## Genel puan nedir?

**Her bölümde elde ettiğin en iyi puanların toplamı.** Bir bölümü tekrar oynayıp daha iyi puan alırsan toplam artar,
kötü oynarsan düşmez. Bu yüzden toplam hiçbir zaman azalmaz ve gönderim başarısız olsa bile bir sonraki gönderim
tüm toplamı taşır (kayıp olmaz).

- Bir bölümün puanı: `bölüm × 100 + (0–300 temiz oynama) + risk bonusu`, en az 100.
- Sıralama: puan yüksek olan önde. **Eşitlikte puana önce ulaşan öndedir.**

## Kurulum (sunucu)

1. **PostgreSQL** hazırla ve `DATABASE_URL` ortam değişkenini ayarla (Replit'te veritabanı sağlayıcısından gelir).
2. Tabloyu oluştur:
   ```bash
   pnpm --filter @workspace/db run push
   ```
3. API sunucusunu başlat (Replit'te zaten `/api` yoluyla yayınlanır):
   ```bash
   pnpm --filter @workspace/api-server run dev
   ```
   `DATABASE_URL` yoksa sunucu çökmez; sıralama uçları `503 unavailable` döner, oyun yerel rekorlarla çalışmaya devam eder.
4. İsteğe bağlı: `NICKNAME_BLOCKLIST=kelime1,kelime2` ile yasaklı takma ad kelimeleri ekle (alt dize eşleşmesi).

## Kurulum (oyun)

Oyunun sunucuyu bulması için **birini** ayarla (Expo ortam değişkeni):

| Değişken | Örnek | Not |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `https://cizgi-kacis.example.app` | `/api` otomatik eklenir. |
| `EXPO_PUBLIC_DOMAIN`  | `cizgi-kacis.example.app` | Replit'te genellikle zaten tanımlıdır. |

İkisi de yoksa sıralama ekranı "sunucu ayarlanmamış" der ve yalnızca yerel rekorları gösterir.

## Oyuncu akışı

1. İlk bölümlerden sonra sonuç kartında **"Sıralamaya katıl"** çıkar. Oyuncu bir **takma ad** seçer (3–16 harf/rakam/boşluk).
2. Sunucu bir `id` ve rastgele bir **gizli anahtar** verir. Anahtar yalnızca cihazda durur, sunucuda sadece SHA-256 özeti saklanır.
3. Her bölüm sonunda ve uygulama açılışında toplam puan **sessizce** gönderilir. Sonuç kartında `Dünya sırası: #12` ve
   yükseliş (`3 basamak yükseldin!`) görünür.
4. Sıralama ekranı (Defter → kupa simgesi): kendi sıran, toplam oyuncu sayısı, ilk 50, ve ilk 50'de değilsen çevrendeki
   oyuncular. Takma ad değiştirilebilir, hesap silinebilir.

## API

Kimlik doğrulama başlıkları: `X-Player-Id: <id>` ve `Authorization: Bearer <gizli anahtar>`.

| Yöntem | Yol | Açıklama |
|---|---|---|
| `POST` | `/api/players` | `{nickname}` → `201 {id, secret, nickname}` (gizli anahtar yalnızca burada görünür) |
| `PATCH` | `/api/players/me` | Takma ad değiştir (kimlik gerekir) |
| `PUT` | `/api/players/me/score` | `{score, levelsCleared, stars, bestLevel}` → `{accepted, score, rank, total}` |
| `DELETE` | `/api/players/me` | Hesabı ve puanı sil → `204` |
| `GET` | `/api/leaderboard?limit=50` | Herkese açık liste. Kimlikle çağrılırsa `me` ve `around` de gelir |

Hatalar JSON'dur: `{error, message, reason?}`; kodlar: `invalid_nickname`, `invalid_score`, `unauthorized`,
`rate_limited` (+`Retry-After`), `unavailable`, `bad_request`, `too_large`, `server_error`.

Genel listede **id, gizli anahtar ya da başka kişisel veri yoktur**: yalnızca sıra, takma ad, puan, yıldız ve bölüm.

## Hile ve kötüye kullanım: dürüst sınırlar

Sunucu oyunu çalıştırmaz, bu yüzden bir puanı **kanıtlayamaz**. Yaptığı şey **olabilirlik denetimi**:

- Puan, tamamlanan bölüm sayısına göre mümkün aralıkta olmalı (`100·n` ile bölüm başına `100·b + 492` toplamı arası).
- Yıldız ≤ 3 × bölüm, `bestLevel` tamamlanan bölümlerle tutarlı olmalı.
- Toplam **asla azalmaz**: eski bir kopya iyi sonucu ezemez.
- Hız sınırları: IP başına saatte 8 kayıt, oyuncu başına dakikada 40 gönderim, IP başına dakikada 120 okuma.
- Takma ad: Unicode harf/rakam/boşluk/`_.-`, yönetici adlarını taklit edemez, isteğe bağlı yasak kelime listesi.

**Ne yapamaz:** kararlı bir kişi, ulaştığı bölüm sayısı için "mümkün" olan en yüksek puanı gönderebilir. Bunu gerçekten
engellemek için sunucuda atışların yeniden oynatılması (replay doğrulaması) gerekir; bu, oyunun fizik motorunu sunucuya
taşımayı gerektirir. Yarışma/ödül gibi değeri olan bir sıralama düşünüyorsan bu eksiği kapatmadan canlıya alma.

Takma adlar herkese açıktır. Uygunsuz içerik için `NICKNAME_BLOCKLIST` ve bir bildirim/silme süreci (ör. veritabanından
satır silme) düşün. Hesap silme oyuncunun kendisi tarafından yapılabilir.

## Testler

```bash
pnpm --filter @workspace/api-server run test      # kurallar, HTTP uçları, istemci ↔ gerçek sunucu, hız sınırı, 503
pnpm --filter @workspace/cizgi-kacis run test:gameplay   # oyunun ürettiği her puanın sunucuca kabul edildiği dahil
```

Postgres sorguları, gerçek bir PostgreSQL motoruna (PGlite) karşı bellek içi modelle rastgele işlemlerle karşılaştırılarak
doğrulandı (eşitlik/sıralama/komşu penceresi dahil).
