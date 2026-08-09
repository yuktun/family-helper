# 我家｜家庭助手

一個可以直接放到 GitHub Pages 的純前端家庭 Mini App。全繁體中文，設計以手機使用為主。

## 本機執行

本專案不需要建置工具或私密 API 金鑰。由專案根目錄啟動任何靜態網站伺服器，例如：

```bash
python -m http.server 8000
```

然後開啟 `http://localhost:8000/`。Service worker、PWA 安裝及部分瀏覽器功能需要透過 HTTP/HTTPS 使用，不建議直接以 `file://` 開啟。

## 已完成功能

- **首頁**
  - 681 / 680 / 89D / 87D，由馬鞍山市中心（MOSTown）往市區方向的實時 ETA
  - 680 / 681 會嘗試合併九巴＋城巴聯營班次；即使城巴資料暫時失敗，九巴 ETA 仍可顯示
  - 每 60 秒自動更新，亦可手動刷新
  - 香港天文台即時氣溫／濕度
  - 家庭清單及今日行程摘要
- **家庭清單**
  - 購物 / 待辦分類
  - 新增、修改、完成、刪除
  - LocalStorage 保存
- **日曆**
  - 月曆
  - 日期事件提示點
  - 新增、修改、刪除家庭行程
  - 家庭 / 學校 / 醫療 / 汽車 / 繳費 / 生日 / 其他分類
- **實用資料**
  - 屋苑 / 醫療 / 學校 / 緊急 / 其他
  - 電話一按撥打
  - 地址一按開地圖
  - 新增、修改、刪除
  - 預設保留 999
- **備份**
  - 匯出 JSON 備份
  - 匯入 JSON 備份
- **PWA**
  - manifest、service worker、app icon
  - iPhone / Android 可加入主畫面

## 使用的公開 API

### 九巴／龍運 ETA

官方公開資料：Transport Department / KMB & LWB

- Route List: `https://data.etabus.gov.hk/v1/transport/kmb/route/`
- Route-Stop: `https://data.etabus.gov.hk/v1/transport/kmb/route-stop/{route}/{direction}/{service_type}`
- ETA: `https://data.etabus.gov.hk/v1/transport/kmb/eta/{stop_id}/{route}/{service_type}`

App 不硬寫 KMB 的 opaque stop ID。它會先從 Route List 判斷目的地方向，再由 Route-Stop 取得 MOSTown 對應 stop ID，最後查 ETA。

目前設定：

| 路線 | 目的地 | MOSTown 對應站序 |
|---|---|---:|
| 681 | 中環（香港站） | 1 |
| 680 | 金鐘 | 4 |
| 89D | 藍田站 | 6 |
| 87D | 紅磡站 | 4 |

> 如果九巴日後永久更改路線站序，可在 `app.js` 最上方 `ROUTES` 修改 `preferredSeq`。

### 城巴（680 / 681 聯營補充）

- Route-Stop: `https://rt.data.gov.hk/v1/transport/citybus-nwfb/route-stop/CTB/{route}/outbound`
- ETA: `https://rt.data.gov.hk/v1/transport/citybus-nwfb/eta/CTB/{stop_id}/{route}`

App 會合併城巴與九巴 ETA，並以約 45 秒的時間差做簡單去重。

### 香港天文台

- Current Weather: `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc`
- 目前優先顯示「沙田」測站氣溫，沒有時使用 API 返回的其他測站。

## GitHub Pages 部署

本專案是獨立的 `family-helper` repository，所有網站檔案均放在 repository 根目錄：

```text
family-helper/
  index.html
  styles.css
  app.js
  sw.js
  manifest.webmanifest
  assets/
```

在 GitHub repository 的 **Settings → Pages**，選擇 **Deploy from a branch**，再選擇預設分支及 **/(root)**。網站網址為：

```text
https://<github-username>.github.io/family-helper/
```

所有 CSS、JavaScript、manifest、service worker 及圖示均使用相對路徑，可在 GitHub Pages 的 `/family-helper/` 子路徑正常運作。

## 私隱與資料儲存

清單、日曆和實用聯絡資料只會儲存在目前瀏覽器的 LocalStorage。專案不會把這些資料上載到伺服器，亦不包含分析、追蹤或廣告程式。請使用「匯出備份」保存資料，並只在信任的裝置匯入備份檔案。

## 注意

1. V1 的家庭清單、日曆及實用資料是 **每部裝置獨立** 的 LocalStorage，未有多人同步。
2. 如果下一版要全家手機同步，建議再接 Firebase / Supabase，並設定安全規則；不要把 private API key / service account secret 放在 public GitHub repo。
3. 公開交通及天氣 API 需要網絡；離線時 App 本身仍可開啟，LocalStorage 功能仍可用，但實時資料不會更新。
4. `design-reference.png` 是本次確認過的 UI 概念圖，方便日後交給 Codex 繼續微調。
