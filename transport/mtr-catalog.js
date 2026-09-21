export const MTR_LINES = Object.freeze({
  AEL: { zh: '機場快綫', en: 'Airport Express', stations: [['AWE','博覽館'],['AIR','機場'],['TSY','青衣'],['KOW','九龍'],['HOK','香港']] },
  TCL: { zh: '東涌綫', en: 'Tung Chung Line', stations: [['TUC','東涌'],['SUN','欣澳'],['TSY','青衣'],['LAK','荔景'],['NAC','南昌'],['OLY','奧運'],['KOW','九龍'],['HOK','香港']] },
  TML: { zh: '屯馬綫', en: 'Tuen Ma Line', stations: [['WKS','烏溪沙'],['MOS','馬鞍山'],['HEO','恆安'],['TSH','大水坑'],['SHM','石門'],['CIO','第一城'],['STW','沙田圍'],['CKT','車公廟'],['TAW','大圍'],['HIK','顯徑'],['DIH','鑽石山'],['KAT','啟德'],['SUW','宋皇臺'],['TKW','土瓜灣'],['HOM','何文田'],['HUH','紅磡'],['ETS','尖東'],['AUS','柯士甸'],['NAC','南昌'],['MEF','美孚'],['TWW','荃灣西'],['KSR','錦上路'],['YUL','元朗'],['LOP','朗屏'],['TIS','天水圍'],['SIH','兆康'],['TUM','屯門']] },
  TKL: { zh: '將軍澳綫', en: 'Tseung Kwan O Line', stations: [['LHP','康城'],['POA','寶琳'],['HAH','坑口'],['TKO','將軍澳'],['TIK','調景嶺'],['YAT','油塘'],['QUB','鰂魚涌'],['NOP','北角']] },
  EAL: { zh: '東鐵綫', en: 'East Rail Line', stations: [['LMC','落馬洲'],['LOW','羅湖'],['SHS','上水'],['FAN','粉嶺'],['TWO','太和'],['TAP','大埔墟'],['UNI','大學'],['RAC','馬場'],['FOT','火炭'],['SHT','沙田'],['TAW','大圍'],['KOT','九龍塘'],['MKK','旺角東'],['HUH','紅磡'],['ADM','金鐘'],['EXC','會展']] },
  SIL: { zh: '南港島綫', en: 'South Island Line', stations: [['ADM','金鐘'],['OCP','海洋公園'],['WCH','黃竹坑'],['LET','利東'],['SOH','海怡半島']] },
  TWL: { zh: '荃灣綫', en: 'Tsuen Wan Line', stations: [['TSW','荃灣'],['TWH','大窩口'],['KWH','葵興'],['KWF','葵芳'],['LAK','荔景'],['MEF','美孚'],['LCK','荔枝角'],['CSW','長沙灣'],['SSP','深水埗'],['PRE','太子'],['MOK','旺角'],['YMT','油麻地'],['JOR','佐敦'],['TST','尖沙咀'],['ADM','金鐘'],['CEN','中環']] },
  ISL: { zh: '港島綫', en: 'Island Line', stations: [['KET','堅尼地城'],['HKU','香港大學'],['SYP','西營盤'],['SHW','上環'],['CEN','中環'],['ADM','金鐘'],['WAC','灣仔'],['CAB','銅鑼灣'],['TIH','天后'],['FOH','炮台山'],['NOP','北角'],['QUB','鰂魚涌'],['TAK','太古'],['SWH','西灣河'],['SKW','筲箕灣'],['HFC','杏花邨'],['CHW','柴灣']] },
  KTL: { zh: '觀塘綫', en: 'Kwun Tong Line', stations: [['TIK','調景嶺'],['YAT','油塘'],['LAT','藍田'],['KWT','觀塘'],['NTK','牛頭角'],['KOB','九龍灣'],['CHH','彩虹'],['DIH','鑽石山'],['WTS','黃大仙'],['LOF','樂富'],['KOT','九龍塘'],['SKM','石硤尾'],['PRE','太子'],['MOK','旺角'],['YMT','油麻地'],['HOM','何文田'],['WHA','黃埔']] },
  DRL: { zh: '迪士尼綫', en: 'Disneyland Resort Line', stations: [['SUN','欣澳'],['DIS','迪士尼']] },
});
export const MTR_ORDER = Object.freeze(['AEL','TCL','TML','TKL','EAL','SIL','TWL','ISL','KTL','DRL']);
export const MTR_STATION_NAMES = Object.freeze(Object.fromEntries(MTR_ORDER.flatMap((line) => MTR_LINES[line].stations)));
export const mtrStationName = (code) => MTR_STATION_NAMES[code] || code;
export const mtrLinesForStation = (station) => MTR_ORDER.filter((line) => MTR_LINES[line].stations.some(([code]) => code === station));
export function searchMtr(query, lineFilter = '') {
  const raw = String(query).trim(); const lower = raw.toLocaleLowerCase(); if (!raw) return [];
  const result = [];
  for (const line of MTR_ORDER) {
    if (lineFilter && line !== lineFilter) continue;
    for (const [station, name] of MTR_LINES[line].stations) {
      let score = 0;
      if (station === raw.toUpperCase() || name === raw) score = 120;
      else if (name.startsWith(raw)) score = 100;
      else if (name.includes(raw) || MTR_LINES[line].en.toLowerCase().includes(lower)) score = 50;
      if (score) result.push({ operator: 'MTR', line, station, name, score });
    }
  }
  return result.sort((a, b) => b.score - a.score || MTR_ORDER.indexOf(a.line) - MTR_ORDER.indexOf(b.line));
}
