export const BUCKET_DURATION_OPTIONS = [
  { value: '1s', label: '1 second' },
  { value: '5s', label: '5 seconds' },
  { value: '10s', label: '10 seconds' },
  { value: '30s', label: '30 seconds' },
  { value: '1m', label: '1 minute' },
  { value: '5m', label: '5 minutes' },
  { value: '15m', label: '15 minutes' },
  { value: '1h', label: '1 hour' },
] as const;

export type BucketDuration = (typeof BUCKET_DURATION_OPTIONS)[number]['value'];
