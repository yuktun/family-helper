# Fu Fai Home｜家庭助手 V2

家庭日常 Mini App，針對手機及 GitHub Pages。介面使用繁體中文，首頁提供香港巴士 ETA / 天氣；家庭清單、日曆及實用資料改用 Firebase Authentication + Cloud Firestore 全家同步。

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
| 681 | 中環（香港站） | MA954 | BA6D9F93E62B8075 |
| 680 | 金鐘 | MA952 | 15FF958BE6921BAA |
| 87D | 紅磡站 | MA303 | 013F884CBCB1CBE4 |
| 89D | 藍田站 | MA310 | 76E8D8C73E0B8096 |
| 89P | 藍田站 | MA310 | 76E8D8C73E0B8096 |

681 / 680 會合併九巴及城巴各自提供的 ETA；任何一個來源失敗都不會令另一個來源失效。城巴使用已核對的固定站碼 `001950`（馬鞍山市中心，22.424134522091, 114.23169341053），並以城巴的 `inbound` 方向及目的地欄位分別核對中環／金鐘方向。不同營辦商時間相近的班次會保留為兩班獨立巴士。

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
```

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
5. 管理員在「資料 → 家庭成員」批准
6. 第二個帳戶立即取得共享資料
7. 681 / 680 / 87D / 89D / 89P 顯示指定站碼 ETA
8. GitHub Pages / PWA 加入主畫面
9. 管理員發佈公告後，登出或使用無痕視窗仍可在四個主頁頂部看到公告，管理員亦可刪除
