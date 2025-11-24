import axios from 'axios';
import type { PingDataResponse, PingDataQuery, PingAggregatedResponse, PingAggregatedQuery } from './types';

// const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8080';
const API_BASE_URL = '/';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export async function fetchPingData(query: PingDataQuery = {}): Promise<PingDataResponse> {
  const params = new URLSearchParams();
  
  if (query.target) {
    params.append('target', query.target);
  }
  if (query.from !== undefined) {
    params.append('from', query.from.toString());
  }
  if (query.to !== undefined) {
    params.append('to', query.to.toString());
  }
  if (query.metric && query.metric !== 'all') {
    params.append('metric', query.metric);
  }
  if (query.limit !== undefined) {
    params.append('limit', query.limit.toString());
  }

  const response = await apiClient.get<PingDataResponse>(`/api/ping/data?${params.toString()}`);
  return response.data;
}

export async function fetchPingAggregated(query: PingAggregatedQuery = {}): Promise<PingAggregatedResponse> {
  const params = new URLSearchParams();
  
  if (query.target) {
    params.append('target', query.target);
  }
  if (query.from !== undefined) {
    params.append('from', query.from.toString());
  }
  if (query.to !== undefined) {
    params.append('to', query.to.toString());
  }
  if (query.metric && query.metric !== 'all') {
    params.append('metric', query.metric);
  }
  if (query.bucket) {
    params.append('bucket', query.bucket);
  }

  const response = await apiClient.get<PingAggregatedResponse>(`/api/ping/aggregated?${params.toString()}`);
  return response.data;
}

