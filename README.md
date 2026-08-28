# Fu Fai Home｜家庭助手 V2

家庭日常 Mini App，針對手機及 GitHub Pages。介面使用繁體中文，首頁提供香港巴士 ETA / 天氣；家庭清單、日曆及實用資料改用 Firebase Authentication + Cloud Firestore 全家同步。

## 最新體驗改進

- 首頁新增「快速處理」，可直接新增清單及家庭行程
- 首頁新增未完成事項與未來行程預覽，減少來回切換頁面
- 實用資料支援名稱、電話、地址及備註即時搜尋
- 寬螢幕改用桌面側邊導覽，手機保留拇指易用的底部導覽
- 加入即時時鐘、鍵盤焦點、減少動態效果支援及更完整空白狀態
- 新增家庭共享筆記與快速記錄
- 新增續期及週期提醒，可設定每月或每年重複
- 家庭行程支援每星期、每月及每年重複
- 以應用程式確認視窗取代原生瀏覽器提示
- 可在設定中選擇首頁模組及需要顯示的巴士路線

## V2 主要更新

- Google 登入及家庭成員批准流程
- 初始管理員：`jatoy0a11@gmail.com`
- 其他 Google 帳戶首次登入會顯示「等待管理員批准」
- 管理員可在「資料 → 家庭成員」批准、拒絕或移除成員
- 家庭清單、日曆、實用資料改為 Firestore 即時同步
- Firestore Web 離線快取（支援情況視瀏覽器而定）
- 全家公告置頂顯示；未登入訪客亦可閱讀，只有管理員可發佈或刪除
- 偵測 V1 LocalStorage 舊資料並提供一次性匯入
- 巴士改用指定站碼，不再自動猜測方向/站位
- 新增 89P

## 指定巴士站

| 路線 | 方向 | 站碼 | KMB Open Data stop_id |
|---|---|---|---|
| 980X | 菲林明道 | MA952 | 15FF958BE6921BAA |
| 681 | 中環（香港站） | MA954 | BA6D9F93E62B8075 |
| 680 | 金鐘 | MA952 | 15FF958BE6921BAA |
| 87D | 紅磡站 | MA303 | 013F884CBCB1CBE4 |
| 89D | 藍田站 | MA310 | 76E8D8C73E0B8096 |
| 89P | 藍田站 | MA310 | 76E8D8C73E0B8096 |

980X / 681 / 680 會合併九巴及城巴各自提供的 ETA；任何一個來源失敗都不會令另一個來源失效。城巴使用已核對的固定站碼 `001950`（馬鞍山市中心，22.424134522091, 114.23169341053）。980X 以城巴 `outbound` 方向及灣仔／Wan Chai 目的地欄位核對；681 / 680 則以城巴 `inbound` 方向及目的地欄位核對中環／金鐘方向。KMB 在固定 MA954 站的 681 正確方向為 `inbound`。不同營辦商時間相近的班次會保留為兩班獨立巴士。

## Firebase

Firebase project: `family-helpers`

使用：

- Firebase Authentication（Google）
- Cloud Firestore

不使用 Realtime Database、Admin SDK、service account 或任何私人金鑰。

Web Firebase config 會出現在 frontend source，這是 Firebase Web App 正常運作所需；真正的資料保護由 Authentication + `firestore.rules` 負責。

### Firestore structure

```text
families/home/
  members/{uid}
  membershipRequests/{uid}
  announcements/{announcementId}
  todos/{todoId}
  calendarEvents/{eventId}
  usefulInfo/{infoId}
  notes/{noteId}
  reminders/{reminderId}
```

## 備份與還原

備份格式目前為版本 3，涵蓋清單、日曆、實用資料、筆記及提醒。匯入前會檢查版本、檔案大小、記錄數量、必要集合、欄位類型、日期及可用選項；不合規格的檔案不會寫入 Firestore。

匯入採用「加入」模式：不會刪除或取代現有雲端資料，也不會自動辨認重複記錄，所以重複匯入同一檔案會產生重複項目。每次備份最多 400 筆記錄及 2 MiB，確保整次匯入可在單一 Firestore batch 內完成；batch 失敗時不會顯示成功訊息。

### 初始管理員

`jatoy0a11@gmail.com` 第一次登入時，App 會建立自己的 approved admin member document。Firestore rules 只容許這個指定 Google 帳戶完成 bootstrap；其他帳戶不能自行提升為 admin。

### Firestore Rules

本 repo 包含 `firestore.rules`。

Firebase Console：

1. Firestore → Rules
2. 將 `firestore.rules` 內容貼入
3. Publish

或安裝 Firebase CLI 後：

```bash
firebase deploy --only firestore:rules
```

`.firebaserc` 已指向 `family-helpers`，`firebase.json` 已指向 `firestore.rules`。

> 首次測試前必須部署 rules；若未部署本 repo 的最新規則，Google 登入／家庭資料及未登入公告讀取都可能無法運作。

## Firebase Authentication

Firebase Console 已需要：

- Authentication → Google：Enabled
- Authorized domains 包含：`yuktun.github.io`

## GitHub Pages

獨立 repo `family-helper`，檔案放 repo root。

Settings → Pages → Deploy from a branch → `main` → `/(root)`

預期網址：

```text
https://yuktun.github.io/family-helper/
```

所有本地資源使用相對路徑；service worker / manifest scope 亦以 repo 子路徑運作。

## 本機執行

不要直接 `file://` 開啟，請使用靜態 server：

```bash
python -m http.server 8000
```

然後開：`http://localhost:8000/`

自動化可靠性測試（不會連接或修改 Firebase）：

```bash
npm test
```

Firestore Rules 的本機 Emulator 測試使用隔離的 `demo-family-helpers` 專案 ID，不需 Firebase 登入，亦不會接觸正式環境：

```bash
npm run test:firestore
```

Firebase 環境核對、相容性限制及正式發布前資料審核方案見 `FIREBASE_ENVIRONMENT.md`。

正式發布前亦必須依照 `RELEASE_CHECKLIST.md` 分別驗證及獲批發布網站與 Firestore Rules。

如要測試 Google Authentication，localhost 一般可作 Firebase Auth 開發來源；實際部署請以 GitHub Pages 測試完整流程。

## V1 LocalStorage migration

管理員第一次成功登入並取得 Firestore 權限後，如果瀏覽器內找到 `family-helper-v1` 的有意義資料，App 會詢問：

> 發現舊有本機資料，是否匯入家庭雲端？

只有確認後才會加入 Firestore，並以 LocalStorage 記錄已完成 migration，避免重複匯入。

## 公開 API

- KMB/LWB ETA: `https://data.etabus.gov.hk/v1/transport/kmb/eta/{stop_id}/{route}/{service_type}`
- Citybus joint-route supplement: `https://rt.data.gov.hk/v1/transport/citybus-nwfb/`
- 香港天文台 Current Weather API

上述資料不需要私人 API key。

## 私隱

不要把真實家庭電話、地址、學校或其他私人資料硬寫入 GitHub source。這些資料應由已批准家庭成員登入後輸入 Firestore。

Repository 不能加入：

- Firebase service-account JSON
- Admin SDK private key
- 私人 token / secret

## 重要測試

部署後建議依次測試：

1. Firestore rules 已 Publish
2. `jatoy0a11@gmail.com` Google 登入 → 顯示「家庭管理員」
3. 新增清單 / 日曆 / 實用資料 → reload 後仍存在
4. 第二個 Google 帳戶登入 → 顯示「等待管理員批准」
5. 管理員在「設定 → 家庭成員」批准
6. 第二個帳戶立即取得共享資料
7. 980X / 681 / 680 / 87D / 89D / 89P 顯示指定站碼 ETA
8. GitHub Pages / PWA 加入主畫面
9. 管理員發佈公告後，登出或使用無痕視窗仍可在四個主頁頂部看到公告，管理員亦可刪除
