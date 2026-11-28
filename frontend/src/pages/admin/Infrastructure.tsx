import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { SystemHealth } from '../../lib/types'
import { Panel, Chip, StatusChip, KVRow, Button } from '../../ui/components'
import { useAdmin } from '../../admin/store'
import { Sparkline, StatusDot, type Tone } from '../../admin/ui'
import type { ServiceStatus } from '../../admin/types'
import { fmtDateTime } from '../../lib/format'

const THRESHOLDS = { cpu: 85, ram: 90, disk: 90, apiResponseMs: 1000, errorRate: 5 }

function svcTone(s: ServiceStatus): Tone {
  if (s === 'Operational') return 'ok'
  if (s === 'Degraded') return 'warn'
  if (s === 'Critical') return 'danger'
  return 'muted'
}

export default function Infrastructure() {
  const { state } = useAdmin()
  const healthQ = useQuery({ queryKey: ['admin-health'], queryFn: () => api<SystemHealth>('/v1/admin/system/health'), refetchInterval: 10_000, retry: false })

  const samples = state.infraSamples
  const latest = samples[samples.length - 1]
  const series = useMemo(() => ({
    cpu: samples.map((s) => s.cpu),
    ram: samples.map((s) => s.ram),
    disk: samples.map((s) => s.disk),
    networkIn: samples.map((s) => s.networkIn),
    networkOut: samples.map((s) => s.networkOut),
    load: samples.map((s) => s.load),
    connections: samples.map((s) => s.connections),
    apiResponseMs: samples.map((s) => s.apiResponseMs),
    errorRate: samples.map((s) => s.errorRate),
  }), [samples])

  return (
    <div className="stack-lg">
      <div className="admin-page-head">
        <div>
          <span className="exhibit-num">SYSTEMS</span>
          <h1 className="display admin-page-title">Infrastructure</h1>
          <p className="muted small" style={{ marginTop: 6 }}>Server monitoring for the live event. Real platform health is read where available; historical charts below are a clearly labeled demo series.</p>
        </div>
        <Chip tone="warn" size="lg">demo + live hybrid</Chip>
      </div>

      <Panel title="Live platform health (real API)" actions={<Button size="sm" onClick={() => void healthQ.refetch()}>Refresh</Button>}>
        {healthQ.isLoading && <span className="loading-inline">Loading</span>}
        {healthQ.isError && <p className="muted small">Monitoring API unreachable. No live values are shown; demo series below are not real metrics.</p>}
        {healthQ.data && (
          <div className="ruled">
            <KVRow k="database app" v={<StatusChip value={String(healthQ.data.databases.app)} />} mono={false} />
            <KVRow k="database gt (ground truth)" v={<StatusChip value={String(healthQ.data.databases.gt)} />} mono={false} />
            {Object.entries(healthQ.data.jobs).map(([status, count]) => <KVRow key={status} k={`jobs: ${status.replaceAll('_', ' ')}`} v={String(count)} />)}
            <KVRow k="oldest queued job" v={`${healthQ.data.oldest_queued_job_age_s}s`} />
            <KVRow k="profile" v={healthQ.data.profile} />
            <KVRow k="environment" v={healthQ.data.environment} />
            <KVRow k="runner" v={healthQ.data.runner_enabled ? 'enabled' : 'disabled'} />
            <KVRow k="ai assessment" v={healthQ.data.ai_assessment_enabled ? 'enabled' : 'disabled'} />
          </div>
        )}
      </Panel>

      <Panel title="Service availability">
        <div className="stat-grid">
          {state.services.map((svc) => (
            <div key={svc.id} className="panel-2" style={{ padding: 12 }}>
              <StatusDot tone={svcTone(svc.status)} label={svc.status} />
              <div style={{ fontWeight: 600, marginTop: 6 }}>{svc.name}</div>
              <div className="muted small">{svc.detail}</div>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>Status labels: Operational, Degraded, Critical, Offline. Code execution is disabled by design in this deployment.</p>
      </Panel>

      <div className="demo-banner">Demo metrics: the time series below are illustrative sample data, not measured live telemetry. Thresholds shown are configured warning levels.</div>

      <div className="stat-grid">
        <MetricCard label="CPU usage" value={latest?.cpu ?? 0} unit="%" threshold={THRESHOLDS.cpu} data={series.cpu} />
        <MetricCard label="RAM usage" value={latest?.ram ?? 0} unit="%" threshold={THRESHOLDS.ram} data={series.ram} />
        <MetricCard label="Disk usage" value={latest?.disk ?? 0} unit="%" threshold={THRESHOLDS.disk} data={series.disk} />
        <MetricCard label="Server load" value={latest?.load ?? 0} unit="" threshold={4} data={series.load} />
        <MetricCard label="Active connections" value={latest?.connections ?? 0} unit="" data={series.connections} />
        <MetricCard label="API response" value={latest?.apiResponseMs ?? 0} unit="ms" threshold={THRESHOLDS.apiResponseMs} data={series.apiResponseMs} />
        <MetricCard label="Error rate" value={latest?.errorRate ?? 0} unit="%" threshold={THRESHOLDS.errorRate} data={series.errorRate} />
      </div>

      <div className="grid-split">
        <Panel title="Network activity (demo)">
          <div className="kv-row"><span className="kv-key">inbound</span><span className="kv-val">{latest?.networkIn ?? 0} KB/s</span></div>
          <div className="kv-row"><span className="kv-key">outbound</span><span className="kv-val">{latest?.networkOut ?? 0} KB/s</span></div>
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <span className="overline">inbound</span><Sparkline data={series.networkIn} width={260} height={44} tone="var(--info)" />
            <span className="overline">outbound</span><Sparkline data={series.networkOut} width={260} height={44} tone="var(--ok)" />
          </div>
        </Panel>
        <Panel title="Recent system incidents">
          {state.recentIncidents.length === 0 ? <p className="muted small">No recent incidents.</p> : state.recentIncidents.map((i) => (
            <div key={i.id} className="kv-row">
              <span className="small"><span style={{ display: 'block', fontWeight: 600 }}>{i.service}</span><span className="muted small">{i.detail}</span></span>
              <span className="mono small muted">{fmtDateTime(i.timestamp)}</span>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  )
}

function MetricCard({ label, value, unit, threshold, data }: { label: string; value: number; unit: string; threshold?: number; data: number[] }) {
  const over = threshold !== undefined && value > threshold
  return (
    <div className="metric-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="overline">{label}</span>
        <StatusDot tone={over ? 'danger' : 'ok'} label={over ? 'over' : 'ok'} />
      </div>
      <span className="mono" style={{ fontSize: 22, color: over ? 'var(--danger)' : 'var(--paper)' }}>{value}{unit}</span>
      <Sparkline data={data} width={160} height={36} tone={over ? 'var(--danger)' : 'var(--signal)'} />
      {threshold !== undefined && <span className="muted small">warning threshold {threshold}{unit}</span>}
    </div>
  )
}