# Speclog — Tasarım

> **Durum:** Tasarım, kullanıcı onayı bekliyor (2026-11-11).
> Repo: `github.com/geometrica-io/Speclog` (private; v1 ile public). Lisans: MIT, telif "Geometrica.io".
> Öncül: `github.com/ovasoft41/ProjectManager` (C++/ImGui, kişisel kullanım; bu belgede "PM").

## 1. Ne ve neden

**Speclog**, bir geliştiricinin bütün repolarındaki görevleri tek ekranda gösteren ve her görevin
durumunu **git'e sorarak** doğrulayan açık kaynak bir üst panodur. Görevler zaten var olan biçimlerden
okunur: Speclog'un kendi `docs/tasks` biçimi, **Backlog.md** ve **GitHub Spec Kit** `tasks.md`.

Kimlik cümlesi: **"Listen gerçeği söylüyor mu? Speclog git'e sorar."**

Neden: Yapay zekâ ajanlarıyla çalışan geliştiriciler görevleri repoda tutuyor (Backlog.md ~7 bin,
Task Master ~28 bin, Spec Kit ~110 bin yıldız; 2026). Bu araçlarda "bitti" bilgisi dosyaya elle ya
da ajanca yazılıyor; iş gerçekten `main`'e girmeden "Done" görünebiliyor ya da bitmiş iş "To Do"
kalabiliyor. Ayrıca hiçbiri birden çok repoyu tek ekranda göstermiyor (Backlog.md'de bu yalnız bir
istek: issue #1069). PM bu sorunu yazarın 11 reposunda (835 madde) çözdü; Speclog onu herkese açar.

Kitle: kendi bağımsız projelerinde, çoğunlukla yapay zekâ ajanlarıyla, birden çok repoda çalışan
geliştiriciler. Yönetici / ekip lideri / müşteri ilk sürümde hedef değil; onlara sonraki sürümlerde
**dışa aktarılan raporlar** gider (§7).

## 2. Hedefler (v1)

1. VS Code ve VS Code tabanlı editörlerde (Google Antigravity, Cursor, Windsurf, VSCodium) çalışan
   bir eklenti; **VS Code Marketplace** ve **Open VSX**'te yayımlanır.
2. Windows, macOS ve Linux (WSL dahil) — eklenti platformdan bağımsız (saf TypeScript).
3. PM ekranının karşılığı: ağaç (Program / Konu / Zaman görünümleri, combobox), seçili maddenin
   özellik tablosu, filtre + arama, Dikkat listesi (§5).
4. Üç kaynak biçimi, adaptör katmanı üzerinden: `docs/tasks` (PM biçimi, birebir), Backlog.md,
   Spec Kit `tasks.md` (§4).
5. Durum git'ten hesaplanır: `Task:` / `Task-Progress:` commit satırları, "Dalda", `main`'e
   ulaşma kuralı (§4.4). Elle yazılmış durumu olan biçimlerde (Backlog.md, Spec Kit) dosyadaki durum
   ayrıca gösterilir ve git ile çelişirse **işaretlenir** (§4.5).
6. Yazarın 11 reposu dönüşümsüz çalışır ve PM ile **aynı sayıları** verir (kabul ölçütü, §9).

## 3. Hedef dışı / istenmeyenler

- **Speclog görev dosyalarını değiştirmez.** v1 salt okunur; tek yazma işi kullanıcının açıkça
  çalıştırdığı "hook kur" komutudur. Bir Backlog.md / Spec Kit kullanıcısının dosyalarına asla
  dokunulmaz.
- Kullanıcıdan biçim değişikliği istemek (istenmeyen: "Speclog kullanmak için dosyalarını taşı").
- Sunucu, hesap ya da internet zorunluluğu (fetch için ağ isteğe bağlı).
- `docs/tasks` biçiminde git kanıtı olmadan "Tamamlandı" göstermek (başarısızlık ölçütü).
- v1'de: raporlar, GitHub girişi / klonlama, CLI, MCP, gelişmiş kod kanıtı, ajan raporu (§7).
- ImGui / yerel pencere: arayüz TypeScript + HTML (VS Code webview). PM ayrı yaşar (§8).

## 4. Veri modeli ve kurallar

### 4.1 Ortak model

Her adaptör aynı modele dönüştürür:
`Program { path, title, id, area, created, spec, groups, items }`,
`Item { id, title, group, storedStatus, fileStatusText, size, priority, area, created, note,
depends[], spec, evidence, historyDate, historyCommit, line }`,
durumlar: `open, partial, bug, verify, decision, dropped, done, onBranch` (PM ile aynı anlamlar)
+ yalnız elle durum yazılan biçimler için `unverified` (§4.5).
Kimlikler repo içinde tekildir; adaptör gerekirse ön ek ekler (§4.3). Kimlik karakterleri:
`[A-Za-z0-9._/-]` (Spec Kit için `/` eklendi).

### 4.2 `docs/tasks` adaptörü (PM biçimi)

PM spec'inin §4.1–§4.4'ü aynen geçerlidir (dosya biçimi, alan tablosu, `###` grupları, miras,
`status: done` + `done:` yalnız tarihçe için, `.since` = dönüşüm commit'inin tam hash'i).
PM'in ayrıştırıcı testleri bu adaptörün testlerine çevrilir. Dosyalar git'ten okunur (çalışma
ağacından değil): ana dal ucu + birleşmemiş dallardaki yalnız-dalda maddeler (PM §4.2a).

### 4.3 Backlog.md ve Spec Kit adaptörleri

- **Backlog.md:** `backlog/tasks/*.md` (+ `backlog/completed/`, arşiv/taslak klasörleri kurucu
  sürüme göre okur ya da atlar) — YAML ön bilgisi: `id`, `title`, `status`, `labels`,
  `dependencies`, `created_date` … Durum adları `backlog/config.yml`'den okunur. Eşleme:
  ilk durum (ör. "To Do") → `open`, ara durumlar (ör. "In Progress") → `partial`, son durum
  (ör. "Done") → dosyada "bitti". Kimlik dosyadaki `id` (ör. `task-12`). `labels` → konu
  (`area`), ilk etiket. Program: tek program "Backlog" (+ varsa milestone'lar grup).
  Kurucu, desteklenen Backlog.md sürüm aralığını belgeye ve testlere yazar (biçim değişebilir).
- **Spec Kit:** `specs/<özellik-klasörü>/tasks.md` — her özellik klasörü bir program
  (başlık: klasör adı / spec.md başlığı, `spec:` = aynı klasördeki `spec.md`). `## Phase …`
  başlıkları grup. `- [ ] T001 [P] [US1] Açıklama` satırları madde; `[x]` → dosyada "bitti".
  Kimlik `<özellik-klasörü>/T001` (T-numaraları özellikler arasında tekrar ettiği için).
  `[P]`, `[USn]` işaretleri nota/etikete gider.
- Bir repo birden fazla biçim kullanıyorsa hepsi okunur; kimlik çakışırsa Dikkat'e düşer.

### 4.4 Git'ten durum (PM §4.3'ün aynısı)

- Commit gövdesindeki `Task: <kimlik>` maddeyi bitirir, `Task-Progress: <kimlik>` bağlar.
  Başka repo için `Task: <RepoAdı>:<kimlik>`. Satır kuralları PM ile birebir.
- Ana dal: `origin/HEAD`'in gösterdiği dal; yoksa `main`, sonra `master`. Bir commit
  `origin/<d>` **ya da** yerel `<d>`'den ulaşılabiliyorsa ana dalda sayılır.
- Sıra: ana dalda kapatan commit → **Tamamlandı** (tarih = en yeni kapatanın tarihi);
  değilse birleşmemiş bir dalda kapatan commit → **Dalda**; değilse dosyadaki durum.
- PM'in son gözden geçirmelerinde düzeltilen bütün kenar durumları korunur: tam ref adları,
  `--end-of-options`, toplu git çağrıları (`for-each-ref --no-merged`, `cat-file --batch-check`,
  tek `log --name-only`, `--stdin`), git hatasında son iyi veriyi koruyup GitError göstermek,
  ilk tarama hatasında yalnız hata göstermek, `GIT_TERMINAL_PROMPT=0`,
  `GCM_INTERACTIVE=never`, `credential.interactive=false`, düşük hız sınırları.

### 4.5 Elle yazılmış durumla çelişki (Backlog.md, Spec Kit)

Ekrandaki durum her zaman §4.4'ten gelir. Dosyadaki durum özellik tablosunda "Dosyada" satırında
görünür.

**Dosyada bitti, git'te kanıt yok (kullanıcı kararı, 2026-11-11):** yeni bir durum,
**Doğrulanmadı** (`unverified`) — kendi rengi (sakin bir amber; uyarı kırmızısı değil), kendi
filtre kutusu ve sayısı ("Bitti 12 · Doğrulanmadı 42 · Açık 30"). Toplamlarda bitmiş sayılmaz.
Ayar `speclog.unverifiedDone`:
- `"unverified"` — **varsayılan**, yukarıdaki gibi;
- `"done"` — Tamamlandı say, yalnız işaretle ve Dikkat'e yaz (yumuşak);
- `"open"` — dosyadaki "bitti"yi yok say, açık göster (katı mod).
`docs/tasks` biçimini etkilemez (orada kanıtsız "bitti" zaten yoktur).

İki yeni Dikkat türü:
- **FileDoneNoGit:** dosyada "bitti" ama ana dalda kapatan commit yok.
- **GitDoneFileOpen:** ana dalda kapatan commit var ama dosyada hâlâ "bitti" değil.

Henüz hiç `Task:` satırı kullanmayan bir repoda ilk açılışta her "Done" maddesi FileDoneNoGit
olur. Bu yüzden bu tür, repo başına tek bir **özet satırı** olarak da gösterilebilmeli
("Bu repoda 42 madde dosyada bitti görünüyor ama git'te kanıtı yok — nasıl bağlanır?")
ve kullanıcı repo başına "bu tarihten önceki dosya durumlarına güven" kesimi koyabilmeli
(`.since` karşılığı; Speclog ayarında saklanır, dosyaya yazılmaz). Kesim öncesinde dosyada
"bitti" olan maddeler **Tamamlandı (dosyadan)** olarak gösterilir ve çelişki sayılmaz.

**Kesim (benim kararım, 2026-11-11):** kesim bir **commit**'tir (PM'in `.since`'i gibi), tarih değil.
Kullanıcı "Speclog: Trust current task files in this repository" komutunu çalıştırınca o anki ana dal
ucunun hash'i Speclog ayarında (repo anahtarıyla, §6) saklanır. "Kesim öncesinde bitti" = görev
dosyalarının **o commit'teki** halinde dosyada bitti olan madde. Kimliksiz iş commit'i ve kesim
sonrası elle `done` denetimleri **yalnız kesimi olan repolarda** çalışır (Backlog.md / Spec Kit
kullanıcılarının Dikkat listesi `Task:` kullanmaya başlamadan dolmasın).

**Okuma kaynağı (benim kararım):** Backlog.md ve Spec Kit dosyaları da git'ten okunur (ana dal ucu +
birleşmemiş dallardaki yalnız-dalda maddeler), çalışma ağacından değil — tek kural: ekran git'i
gösterir. Bir repoda görev dosyalarında commit'lenmemiş değişiklik varsa repo satırında bilgi
işareti + Dikkat'te tek satır "commit'lenmemiş görev değişiklikleri" (durumu etkilemez).

**Kimlik karşılaştırma (benim kararım):** `docs/tasks` ve Spec Kit kimlikleri büyük/küçük harfe
duyarlı; Backlog.md kimlikleri duyarsız (`task-12` = `TASK-12`), alt görevler (`task-12.1`) ayrı
madde. Desteklenen Backlog.md sürüm aralığı kurucunun test ettiği aralıktır ve README'de yazılır.

### 4.6 Dikkat listesi

PM §7'deki bütün türler (bekleyen dal, kimliksiz iş commit'i, kanıt çelişkisi, bilinmeyen
kimlik, biçim sorunları, tekrar eden kimlik, görev dosyası olmayan repo, `.since` sonrası
elle `done`, fetch hatası, git hatası) + §4.5'teki iki tür.

## 5. Ekran (v1)

- **Etkinlik çubuğunda Speclog simgesi** → editör alanında tek bir webview paneli açar ("Speclog").
  Durum çubuğunda özet: `Speclog: 235/599 · ⚠ 1` (tıklayınca panel).
- Panel yerleşimi PM'in onaylı ekranıyla aynı: üst çubuk (Görünüm combobox, arama, Filtre,
  özet, Dikkat düğmesi), solda ağaç (dal satırında `bitti / toplam`, madde satırında kimlik ·
  başlık · sağa yaslı renkli durum etiketi), sağda özellik tablosu (gruplar: Madde, Açıklama,
  Kaynak ve iz [+ "Dosyada" satırı], Kanıt), altta Dikkat paneli. Bütün yazılar aynı boyut.
- Filtre: durum kutuları + sayılar, hazır seçimler (Tümü, Açık işler, Tamamlananlar, Dalda,
  Hatalar), gizlenen repolar, boyut. Görünüm, filtre, açık dallar ve seçim hatırlanır.
- Renkler ve yazı tipleri VS Code temasından (`--vscode-*` değişkenleri); açık / koyu /
  yüksek karşıtlık temalarında okunur. Klavye ile gezilebilir.
- Spec bağlantısı ve görev dosyası VS Code'da açılır (repo dışına çıkmayan yollar).
  Commit'e tıklayınca hash kopyalanır; VS Code'un yerleşik git görünümü varsa orada açılır.
- Dil: arayüz İngilizce varsayılan + Türkçe (VS Code `l10n`), editörün diline göre.

## 6. Kaynaklar, yenileme, ayarlar

- Taranan repolar: VS Code'da açık çalışma klasörleri (kendisi repo ya da bir alt klasörü repo
  olanlar) + `speclog.roots` ayarındaki klasörlerin doğrudan alt klasörleri (PM'in `C:\Antigravity`
  davranışı). `speclog.exclude` (klasör adları), `speclog.originFilter` (boş = hepsi; ör.
  `github.com/ovasoft41/`). `.git`'i dosya olan worktree'ler ayrı repo sayılmaz.
- Yenileme: PM ile aynı — ref/HEAD değişikliği izlenir, değişen repo yeniden taranır, arayüz
  donmaz (tarama eklenti sürecinde asenkron; büyük işler worker'a alınabilir).
- `speclog.fetch.enabled` (varsayılan açık), `speclog.fetch.intervalSeconds` (300). Fetch
  yalnız `origin` uzak referanslarını günceller; çalışma ağacına dokunmaz.
- Ayarlar VS Code ayarlarında; arayüz durumu `workspaceState`/`globalState`'te. Repolara yazılmaz.
- **Repo adı ve anahtarı (benim kararım):** repo adı `origin` adresindeki depo adıdır (ör.
  `StructuralFEASuite`); `origin` yoksa klasör adı. `Task: <Ad>:<kimlik>` büyük/küçük harfe
  duyarsız ada göre çözülür; aynı adlı iki repo varsa `Task: <sahip>/<ad>:<kimlik>` biçimi de
  kabul edilir, yalın ad belirsiz kalırsa Dikkat'e düşer. Repo başına ayarlar (kesim, gizleme)
  `origin` adresiyle (yoksa mutlak yolla) anahtarlanır.
- **Uzak geliştirme (benim kararım):** eklenti `extensionKind: ["workspace"]` — çalışma alanının
  bulunduğu yerde çalışır: yerel, Remote-WSL, Remote-SSH, Dev Containers. Böylece ekranı olmayan
  bir container'daki repolar da VS Code istemcisinin ekranında görünür. Windows'tan `\\wsl$`
  yollarını taramak desteklenmez (WSL içinde açılan pencere kullanılır).
- Komutlar: "Speclog: Open", "Speclog: Refresh", "Speclog: Install commit-msg hook in this
  repository" (PM'in hook'unun platformdan bağımsız POSIX `sh` sürümü; mevcut hook korunur ve
  zincirlenir; `core.hooksPath` varsa uyarıp kurmaz).

## 7. Yol haritası (v1 sonrası, kısa)

- **v1.x Raporlar:** haftalık / aylık / seçilen aralık — kapanan, açılan, dalda bekleyen maddeler;
  repo / program / konu kırılımı; ilerleme yüzdesi ve zaman eğrisi (geçmiş, o tarihteki git
  durumundan yeniden hesaplanır). Dışa aktarım: tek dosyalık HTML, PDF, Markdown. Yönetici /
  müşteri için paylaşılabilir.
- **v2 GitHub:** VS Code'un yerleşik GitHub kimlik sağlayıcısıyla giriş, repo listesi + seçim,
  seçilenlerin eklentinin kendi depolama alanına hafif klonu (`--filter=blob:none`).
- **v2 Ajanlar:** `speclog` CLI (npm) ve MCP sunucusu — aynı çekirdek; "açık işler neler?",
  "bu oturumda ne kapandı?".
- Sonra: gelişmiş kod kanıtı, ajan oturum raporu, ilerleme zaman çizelgesi, başka biçimler
  (adaptör ekleyerek).

## 8. Mimari

- Dil: **TypeScript** (çekirdek + eklenti). Monorepo: `packages/core` (VS Code'dan bağımsız,
  Node `child_process` ile `git`), `packages/vscode` (eklenti + webview). v2'de `packages/cli`.
- Çekirdek PM çekirdeğinin çevirisidir: TaskFile → adaptörler, GitRunner, GitRepo, Snapshot,
  StatusEngine, Attention, ViewTree, Scheduler. Kurallar ve **testler** PM'den taşınır (PM'de
  166 doctest vakası + hook testleri); git testleri geçici klasörde gerçek repolarla.
- Eklenti tek ("universal") paket; yerel ikili yok.
- CI: GitHub Actions — Windows / macOS / Linux üzerinde testler; etikette `vsce` ve `ovsx`
  ile yayım (yayımcı adı `geometrica`, yayın sırasında açılır).

## 9. Kabul ölçütleri (v1)

1. Yazarın `C:\Antigravity` kökünde Speclog, PM'in `--check` çıktısıyla aynı sayıları verir
   (repo başına bitti/toplam ve PM'de de var olan türlerdeki Dikkat sayısı). Taban: köken filtresi
   düzeltmesi (§10) yapılmış PM; iki araç aynı repo kümesine bakar (Speclog reposu dahil).
   Yalnız Speclog'da olan Dikkat türleri karşılaştırmaya girmez; başka her fark ya düzeltilir
   ya da hangi aracın neden haklı olduğu yazılarak açıklanır.
2. Örnek bir Backlog.md reposu ve örnek bir Spec Kit reposu (testlerde üretilir) ayarsız açılır,
   maddeler görünür, §4.5 çelişkileri doğru işaretlenir.
3. Windows, macOS, Linux CI'da testler yeşil; eklenti VS Code ve Antigravity'de açılır.
4. 11 repo / ~850 maddelik bir çalışma alanında arayüz tarama sırasında donmaz.

## 10. PM ile ilişki

PM dondurulur: yalnız hata düzeltmesi. Speclog §9.1'i sağladığında PM reposu "arşivlendi,
yerine Speclog" notuyla arşivlenir. Bekleyen küçük PM düzeltmesi: köken filtresine ikinci hesap
(`github.com/geometrica-io/`) eklenmesi, böylece Speclog'un kendi `docs/tasks`'ı PM'de görünür.

## 11. Kurucuya bırakılanlar

Webview arayüz kütüphanesi (çerçevesiz TS ya da hafif bir kütüphane), test çerçevesi, monorepo
aracı, paketleyici, durum renklerinin tam değerleri (VS Code tema değişkenlerinden), Backlog.md
klasörlerinden hangilerinin okunacağı (sürüm belgelerine göre), dosya izleme yöntemi.
