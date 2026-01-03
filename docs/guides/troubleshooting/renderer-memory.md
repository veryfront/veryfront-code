# Renderer Memory Troubleshooting

Guide for diagnosing and resolving memory issues in the veryfront-renderer pods.

## Quick Reference

| Issue | Exit Code | Cause | Fix |
|-------|-----------|-------|-----|
| V8 OOM | 133 (SIGTRAP) | V8 heap exhausted | Increase `--max-old-space-size` |
| Container OOM | 137 (SIGKILL) | Container memory limit exceeded | Increase container memory limit |
| Slow restarts | N/A | Memory pressure during startup | Check ephemeral-storage, increase resources |

---

## Exit Code 133 (SIGTRAP) - V8 Heap Exhaustion

### Symptoms

```
CrashLoopBackOff
Exit Code: 133
```

Logs show:
```
Fatal JavaScript out of memory: Ineffective mark-compacts near heap limit
```

### Root Cause

V8 (Deno's JavaScript engine) calculates heap size as ~50% of container memory by default. When the container has 1Gi memory limit, V8 gets ~512MB heap, which may be insufficient for SSR workloads.

### Solution

Set explicit V8 heap size via `DENO_V8_FLAGS`:

```yaml
# values.yaml
renderer:
  env:
    # V8 heap at 70% of container memory limit
    DENO_V8_FLAGS: "--max-old-space-size=1024"
  resources:
    limits:
      memory: "1536Mi"
```

Formula: `--max-old-space-size` = container_memory_limit × 0.70

### Recommended Resource Sizing

| Tier | Memory Limit | V8 Heap | CPU Request | CPU Limit |
|------|--------------|---------|-------------|-----------|
| Minimal | 2Gi | 1400MB | 250m | 1000m |
| Standard | 3Gi | 2100MB | 500m | 2000m |
| Heavy Load | 4Gi | 2800MB | 1000m | 4000m |

**Note**: Memory requirements are high due to per-module processing in VirtualModuleSystem. Code optimization is planned.

---

## Exit Code 137 (SIGKILL) - Container OOM

### Symptoms

```
OOMKilled
Exit Code: 137
```

### Root Cause

Container exceeded Kubernetes memory limit. Unlike V8 OOM, this is the kernel killing the container.

### Solution

1. Increase container memory limits
2. Check for memory leaks in application code
3. Review multi-project adapter cache sizes

---

## Diagnostic Commands

### Check Pod Status

```bash
kubectl get pods -l app.kubernetes.io/name=veryfront-renderer -w
kubectl describe pod <pod-name> | grep -A 20 "Last State"
```

### View Memory Usage

```bash
# Current memory usage
kubectl top pod -l app.kubernetes.io/name=veryfront-renderer

# Memory over time (requires metrics-server)
kubectl top pod <pod-name> --containers
```

### Check Logs for OOM

```bash
# Recent logs
kubectl logs <pod-name> --tail=100

# Previous container logs (after crash)
kubectl logs <pod-name> --previous --tail=100 | grep -i "memory\|heap\|fatal"
```

### Grafana Queries

```promql
# Container memory usage
container_memory_working_set_bytes{pod=~"veryfront-renderer.*"}

# Restart count
kube_pod_container_status_restarts_total{container="veryfront-renderer"}

# OOM kills
kube_pod_container_status_last_terminated_reason{reason="OOMKilled", container="veryfront-renderer"}
```

---

## Alerting Rules

Add these Prometheus rules for proactive monitoring:

```yaml
groups:
  - name: veryfront-renderer
    rules:
      - alert: RendererHighRestarts
        expr: increase(kube_pod_container_status_restarts_total{container="veryfront-renderer"}[1h]) > 3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Renderer pod restarting frequently"
          description: "{{ $labels.pod }} has restarted {{ $value }} times in the last hour"

      - alert: RendererMemoryHigh
        expr: container_memory_working_set_bytes{container="veryfront-renderer"} / container_spec_memory_limit_bytes{container="veryfront-renderer"} > 0.85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Renderer memory usage above 85%"
          description: "{{ $labels.pod }} is using {{ $value | humanizePercentage }} of memory limit"

      - alert: RendererCrashLoop
        expr: kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff", container="veryfront-renderer"} == 1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Renderer in CrashLoopBackOff"
          description: "{{ $labels.pod }} is in CrashLoopBackOff state"
```

---

## Common Scenarios

### Scenario: Crashes During High Traffic

**Symptoms**: Pods crash when handling many concurrent SSR requests

**Investigation**:
1. Check memory usage trending up before crash
2. Review MultiProjectFSAdapter cache stats
3. Check for large component trees

**Resolution**:
1. Increase pod replicas (horizontal scaling)
2. Increase memory limits (vertical scaling)
3. Enable request queuing/rate limiting at proxy level

### Scenario: Crashes Only on Specific Nodes

**Symptoms**: Same image crashes on some nodes but not others

**Investigation**:
1. Check node resources: `kubectl describe node <node-name>`
2. Check for resource pressure: `kubectl get events --field-selector reason=Evicted`
3. Compare node specs (CPU generation, available memory)

**Resolution**:
1. Add node affinity to schedule on appropriate nodes
2. Check for noisy neighbors on shared nodes

### Scenario: Memory Grows Over Time

**Symptoms**: Pod restarts periodically after running for hours

**Investigation**:
1. Graph memory usage over time in Grafana
2. Check for unbounded caches in application code
3. Review import map and module caches

**Resolution**:
1. Implement LRU eviction in caches
2. Set max cache sizes
3. Schedule periodic pod restarts if leak is unfixable

---

## Known Memory Issues

### VirtualModuleSystem Inefficiencies

Location: `src/rendering/virtual-module-system.ts`

**Issues**:
1. `loadImportMap()` called for every module registration (no caching)
2. `esbuild.initialize()` called per module (should be once)
3. Double transformation: components processed by both VirtualModuleSystem and SSRModuleLoader

**Impact**: Memory usage can exceed 1.5Gi under load

**Workaround**: Increase memory limits to 3Gi+ until code optimization is implemented

### Planned Optimizations

- Cache import map at VirtualModuleSystem level
- Initialize esbuild once at startup
- Deduplicate component transformation pipeline
- Add memory pressure monitoring

---

## Related Documentation

- [Observability Module](../../../src/observability/README.md)
- [Debugging Guide](./debugging.md)
- [Helm Chart Values](../../../chart/values.yaml)
