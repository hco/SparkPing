import axios from 'axios';
import type { PingAggregatedResponse, PingAggregatedQuery, Target, TargetRequest, StorageStatsResponse } from './types';
import { getBasePath } from './lib/basePath';

// Use dynamic base path for Home Assistant ingress support
const API_BASE_URL = getBasePath();

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

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

// Target management API functions

export async function fetchTargets(): Promise<Target[]> {
  const response = await apiClient.get<Target[]>('/api/targets');
  return response.data;
}

export async function createTarget(target: TargetRequest): Promise<Target> {
  const response = await apiClient.post<Target>('/api/targets', target);
  return response.data;
}

export async function updateTarget(id: string, target: TargetRequest): Promise<Target> {
  const response = await apiClient.put<Target>(`/api/targets/${id}`, target);
  return response.data;
}

export async function deleteTarget(id: string): Promise<void> {
  await apiClient.delete(`/api/targets/${id}`);
}

export async function fetchStorageStats(): Promise<StorageStatsResponse> {
  const response = await apiClient.get<StorageStatsResponse>('/api/storage/stats');
  return response.data;
}

