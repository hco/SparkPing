import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, DatabaseZap, RotateCcw, XCircle } from 'lucide-react';
import { fetchHealth } from '@/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { HealthIssue, MigrationState } from '@/types';

/** Shows problems reported by GET /api/health and the progress of the data migration. */
export function HealthBanner() {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    // Poll faster while the migration runs so its progress moves visibly.
    refetchInterval: (query) =>
      query.state.data?.migration.state === 'running' ? 15_000 : 60_000,
  });

  if (!health) return null;
  if (health.issues.length === 0 && !hasMigrationNotice(health.migration)) return null;

  return (
    <div className="container mx-auto px-4 pt-4 space-y-2">
      {health.issues.map((issue) => (
        <IssueAlert key={issue.kind} issue={issue} />
      ))}
      <MigrationNotice migration={health.migration} />
    </div>
  );
}

function IssueAlert({ issue }: { issue: HealthIssue }) {
  const isError = issue.severity === 'error';
  const Icon = isError ? XCircle : AlertTriangle;
  return (
    <Alert variant={isError ? 'destructive' : 'default'}>
      <Icon />
      <AlertTitle>{isError ? 'SparkPing has a problem' : 'SparkPing needs attention'}</AlertTitle>
      <AlertDescription>{issue.message}</AlertDescription>
    </Alert>
  );
}

function hasMigrationNotice(migration: MigrationState): boolean {
  return migration.state === 'running' || migration.state === 'completed';
}

function MigrationNotice({ migration }: { migration: MigrationState }) {
  if (migration.state === 'running') {
    return (
      <Alert>
        <DatabaseZap />
        <AlertTitle>Migrating data from the previous version: {migration.percent}%</AlertTitle>
        <AlertDescription>
          Pings are recorded as usual. Older history appears in the charts as the migration
          progresses.
        </AlertDescription>
      </Alert>
    );
  }
  if (migration.state === 'completed') {
    return (
      <Alert>
        <RotateCcw />
        <AlertTitle>Data migration finished</AlertTitle>
        <AlertDescription>
          Restart SparkPing to free the memory the migration used.
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
