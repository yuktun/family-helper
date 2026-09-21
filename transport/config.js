export const OPERATORS = Object.freeze({
  KMB: { id: 'KMB', label: '九巴', mode: 'bus' },
  LWB: { id: 'LWB', label: '龍運', mode: 'bus' },
  CTB: { id: 'CTB', label: '城巴', mode: 'bus' },
  GMB: { id: 'GMB', label: '專線小巴', mode: 'minibus' },
  MTR: { id: 'MTR', label: '港鐵', mode: 'rail' },
});

export const API = Object.freeze({
  KMB: 'https://data.etabus.gov.hk/v1/transport/kmb',
  CTB: 'https://rt.data.gov.hk/v2/transport/citybus',
  CTB_BATCH: 'https://rt.data.gov.hk/v1/transport/batch',
  GMB: 'https://data.etagmb.gov.hk',
  MTR: 'https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php',
});

export const CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_REFRESH_SECONDS = 30;
export const BUS_DIRECTIONS = Object.freeze(['O', 'I']);
export const MTR_DIRECTIONS = Object.freeze(['UP', 'DOWN']);
