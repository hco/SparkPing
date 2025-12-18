import { createFileRoute, Link } from '@tanstack/react-router'
import { useDashboardData } from '@/hooks/useDashboardData'
import { Sparkline, PacketLossSparkline } from '@/components/Sparkline'
import { LoadingState } from '@/components/LoadingState'
import { ErrorDisplay } from '@/components/ErrorDisplay'
import { chartColors, getPacketLossClass, getLatencyStatusColor } from '@/lib/chartColors'
import { RefreshCw, Settings, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import '../App.css'

export const Route = createFileRoute('/')({
  component: Dashboard,
})

function Dashboard() {
  const { targetStats, isLoading, error, refetch } = useDashboardData({
    enabled: true,
    refetchInterval: 5000,
  })

  const formatLatency = (value: number | null): string => {
    if (value === null) return '—'
    if (value < 1) return `${(value * 1000).toFixed(0)}µs`
    if (value >= 1000) return `${(value / 1000).toFixed(2)}s`
    return `${value.toFixed(1)}ms`
  }

  return (
    <div className="min-h-screen bg-background w-screen">
      <div className="container mx-auto px-6 py-8">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">SparkPing</h1>
            <p className="text-muted-foreground text-sm mt-1">Network monitoring dashboard</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Link to="/settings">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
              >
                <Settings className="size-4" />
              </Button>
            </Link>
          </div>
        </header>

        {error && (
          <ErrorDisplay error={error instanceof Error ? error.message : 'Failed to fetch data'} />
        )}

        {isLoading && targetStats.length === 0 ? (
          <LoadingState />
        ) : targetStats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-muted-foreground text-6xl mb-4">📡</div>
            <h2 className="text-xl font-semibold text-foreground mb-2">No targets configured</h2>
            <p className="text-muted-foreground mb-6">Add your first ping target to start monitoring.</p>
            <Link to="/settings">
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Settings className="size-4 mr-2" />
                Configure Targets
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Table header */}
            <div className="grid grid-cols-[80px_1fr_80px_80px_80px_70px_130px_130px] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <div></div>
              <div>Target</div>
              <div className="text-right">Min</div>
              <div className="text-right">Median</div>
              <div className="text-right">Max</div>
              <div className="text-right">Loss</div>
              <div className="text-center">Latency</div>
              <div className="text-center">Packet Loss</div>
            </div>

            {/* Target rows */}
            {targetStats.map((stat) => {
              const latencyData = stat.recentData.map((d) => d.avg ?? 0)
              const packetLossData = stat.recentData.map((d) => 
                d.count > 0 ? (d.failed_count / d.count) * 100 : 0
              )
              
              // Get the latest data point
              const latestData = stat.recentData.length > 0 
                ? stat.recentData[stat.recentData.length - 1] 
                : null
              const latestLatency = latestData?.avg ?? null
              const latestHadFailures = latestData ? latestData.failed_count > 0 : false
              const statusColor = getLatencyStatusColor(latestLatency, latestHadFailures)

              return (
                <Link
                  key={stat.target.id}
                  to="/targets/$targetId"
                  params={{ targetId: stat.target.address }}
                  className="block"
                >
                  <div className="grid grid-cols-[80px_1fr_80px_80px_80px_70px_130px_130px] gap-3 items-center px-4 py-4 bg-card border border-border rounded-lg hover:bg-accent hover:border-accent transition-colors group">
                    {/* Latest ping - prominent display */}
                    <div className="flex flex-col items-center">
                      <div className="flex items-center gap-1">
                        <Activity 
                          className="size-3 animate-pulse" 
                          style={{ color: statusColor }}
                        />
                        <span 
                          className="font-mono text-sm font-semibold"
                          style={{ color: statusColor }}
                        >
                          {formatLatency(latestLatency)}
                        </span>
                      </div>
                      <span className="text-[9px] text-muted-foreground">
                        live
                      </span>
                    </div>

                    {/* Target name */}
                    <div>
                      <div className="font-medium text-foreground group-hover:text-emerald-500 transition-colors">
                        {stat.displayName}
                      </div>
                      {stat.target.name && (
                        <div className="text-xs text-muted-foreground mt-0.5">{stat.target.address}</div>
                      )}
                    </div>

                    {/* Min latency */}
                    <div className="text-right font-mono text-sm" style={{ color: chartColors.min }}>
                      {formatLatency(stat.latency.min)}
                    </div>

                    {/* Median latency */}
                    <div className="text-right font-mono text-sm" style={{ color: chartColors.median }}>
                      {formatLatency(stat.latency.median)}
                    </div>

                    {/* Max latency */}
                    <div className="text-right font-mono text-sm" style={{ color: chartColors.max }}>
                      {formatLatency(stat.latency.max)}
                    </div>

                    {/* Packet loss */}
                    <div className={`text-right font-mono text-sm ${getPacketLossClass(stat.packetLoss)}`}>
                      {stat.packetLoss.toFixed(1)}%
                    </div>

                    {/* Latency sparkline */}
                    <div className="flex justify-center overflow-hidden">
                      <Sparkline
                        data={latencyData}
                        width={110}
                        height={32}
                        color={chartColors.median}
                        showArea={true}
                      />
                    </div>

                    {/* Packet loss sparkline */}
                    <div className="flex justify-center overflow-hidden">
                      <PacketLossSparkline
                        data={packetLossData}
                        width={110}
                        height={24}
                      />
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        {/* Footer with auto-refresh indicator */}
        <div className="mt-8 text-center text-xs text-muted-foreground">
          Auto-refreshing every 5 seconds • Last hour data • 1-minute resolution
        </div>
      </div>
    </div>
  )
}
