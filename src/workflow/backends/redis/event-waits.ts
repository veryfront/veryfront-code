import type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";
import { ORCHESTRATION_ERROR, RESOURCE_NOT_FOUND } from "#veryfront/errors";
import type {
  PersistedPendingEventWait,
  RunEventDeliveryClaim,
  RunEventEnvelope,
} from "#veryfront/workflow/backends/types.ts";
import type { WorkflowStatus } from "#veryfront/workflow/types.ts";
import {
  MAX_WORKFLOW_PENDING_EVENT_WAIT_ENTRIES,
  MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES,
  MAX_WORKFLOW_RUN_EVENT_MAILBOXES,
} from "#veryfront/workflow/limits.ts";
import { serializeWorkflowJson } from "#veryfront/workflow/context-serialization.ts";

/** Atomic mailbox eligibility shared with existing run-status mutations. */
export const UPDATE_EVENT_MAILBOX_ELIGIBILITY_LUA = `
local function mailboxProtected(status,state)
  if status == 'pending' or status == 'running' or status == 'waiting' or status == 'failed' then return true end
  if next(state.claims) then return true end
  for _,w in ipairs(state.waits) do
    if w.status == 'pending' or (w.claimedAt and ((w.kind == 'delay' and w.status == 'delivered') or
      (w.kind == 'event' and w.status == 'expired'))) then return true end
  end
  return false
end
local function updateEventMailboxEligibility(runKey,runId,state)
  local prefix=string.sub(runKey,1,#runKey-#runId-4)
  local index=prefix .. 'index:event-mailboxes'
  local candidates=index .. ':evictable'
  local score=redis.call('zscore',index,runId)
  if not score then redis.call('zrem',candidates,runId); return end
  local status=redis.call('hget',runKey,'status')
  if status == 'pending' or status == 'running' or status == 'waiting' or status == 'failed' then
    redis.call('zrem',candidates,runId); return
  end
  if not state then
    local raw=redis.call('get',prefix .. 'event-state:' .. runId)
    state=raw and cjson.decode(raw) or {waits={},mail={},claims={}}
  end
  if mailboxProtected(status,state) then redis.call('zrem',candidates,runId)
  else redis.call('zadd',candidates,score,runId) end
end
local function clearTerminalRunEvents(runKey,runId)
  local status=redis.call('hget',runKey,'status')
  if status ~= 'completed' and status ~= 'cancelled' then return end
  local prefix=string.sub(runKey,1,#runKey-#runId-4)
  local key=prefix .. 'event-state:' .. runId
  local raw=redis.call('get',key)
  if not raw then return end
  local state=cjson.decode(raw)
  local nodes={}
  if status == 'completed' then nodes=cjson.decode(redis.call('hget',runKey,'nodeStates') or '{}') end
  for eventId,claim in pairs(state.claims) do
    for _,w in ipairs(state.waits) do
      if w.id == claim.waitId then
        w.claimedAt=nil; w.recoveryClaimedAt=nil; w.claimedEventId=nil
        local node=nodes[w.nodeId]
        if status == 'completed' and node and node.status == 'completed' then w.deliveredEventId=eventId end
        break
      end
    end
  end
  state.mail={}; state.claims={}
  redis.call('zrem',prefix .. 'index:event-mailboxes',runId)
  local active=false
  for _,w in ipairs(state.waits) do
    if w.status == 'pending' or (w.claimedAt and ((w.kind == 'delay' and w.status == 'delivered') or
      (w.kind == 'event' and w.status == 'expired'))) then active=true end
  end
  if active then redis.call('sadd',prefix .. 'index:event-state',runId)
  else redis.call('srem',prefix .. 'index:event-state',runId) end
  redis.call('set',key,cjson.encode(state))
end
`;

const RECONCILE_EVENT_MAILBOXES_SCRIPT = `-- reconcile-event-mailboxes
${UPDATE_EVENT_MAILBOX_ELIGIBILITY_LUA}
local ids=cjson.decode(ARGV[2])
for _,id in ipairs(ids) do updateEventMailboxEligibility(ARGV[1] .. 'run:' .. id,id) end
return #ids
`;

// Payloads remain opaque JSON strings inside Redis state. Lua only interprets
// envelope metadata, so an empty array in a user payload never becomes {}.
const EVENT_STATE_SCRIPT = `-- workflow-event-state
${UPDATE_EVENT_MAILBOX_ELIGIBILITY_LUA}
local op = ARGV[1]
local p = cjson.decode(ARGV[2])
local raw = redis.call('get', KEYS[1])
local s = raw and cjson.decode(raw) or {waits={}, mail={}, claims={}}
local now = tonumber(ARGV[5])
local function encode(v) return cjson.encode(v) end
local function findWait(id)
  for _, w in ipairs(s.waits) do if w.id == id then return w end end
end
local function clearClaim(w)
  w.claimedAt=nil; w.recoveryClaimedAt=nil; w.claimedEventId=nil
end
local function timed(w)
  return w.claimedAt and ((w.kind == 'delay' and w.status == 'delivered') or
    (w.kind == 'event' and w.status == 'expired'))
end
local function sameNode(a,b)
  return a.nodeId == b.nodeId and (not a.instance or not b.instance or a.instance == b.instance)
end
local function mailIndex(name, cutoff)
  for i,e in ipairs(s.mail) do
    if e.name == name and (not cutoff or e.at <= cutoff) then return i end
  end
end
local function restore(e)
  for _, existing in ipairs(s.mail) do if existing.id == e.id then return end end
  if not e.order then table.insert(s.mail,1,e); return end
  local i=1
  while i <= #s.mail do
    local existing=s.mail[i]
    if e.order and existing.order then
      if existing.order > e.order then break end
    elseif existing.at > e.at then break end
    i=i+1
  end
  table.insert(s.mail,i,e)
end
local function reserveMailbox()
  if redis.call('zscore',KEYS[6],ARGV[6]) then return end
  if redis.call('zcard',KEYS[6]) >= tonumber(ARGV[7]) then
    local eligible=nil
    local id=redis.call('zrange',KEYS[6] .. ':evictable',0,0)[1]
    if id and not redis.call('zscore',KEYS[6],id) then
      redis.call('zrem',KEYS[6] .. ':evictable',id); id=nil
    end
    if id then
      local stateKey=ARGV[8] .. 'event-state:' .. id
      local otherRaw=redis.call('get',stateKey)
      local other=otherRaw and cjson.decode(otherRaw) or {waits={},mail={},claims={}}
      local status=redis.call('hget',ARGV[8] .. 'run:' .. id,'status')
      if not mailboxProtected(status,other) then eligible={id=id,key=stateKey,state=other,status=status} end
    end
    if not eligible then return redis.error_reply('Run event mailbox capacity reached') end
    redis.call('zrem',KEYS[6],eligible.id)
    redis.call('zrem',KEYS[6] .. ':evictable',eligible.id)
    if not eligible.status then
      redis.call('del',eligible.key)
      redis.call('srem',KEYS[2],eligible.id)
    else
      eligible.state.mail={}; redis.call('set',eligible.key,encode(eligible.state))
      local revision=redis.call('incr',KEYS[5])
      redis.call('hset',ARGV[8] .. 'run:' .. eligible.id,'__runRetentionRevision',tostring(revision))
      local metadata=redis.call('hget',KEYS[4],eligible.id)
      if metadata then
        local m=cjson.decode(metadata); m.revision=revision
        redis.call('hset',KEYS[4],eligible.id,encode(m))
      end
    end
  end
  return nil
end
local function commit(result)
  if #s.mail > 0 or next(s.claims) then redis.call('zadd',KEYS[6],'NX',(s.mail[1] and s.mail[1].order) or now,ARGV[6])
  else redis.call('zrem',KEYS[6],ARGV[6]) end
  updateEventMailboxEligibility(KEYS[3],ARGV[6],s)
  if #s.waits == 0 and #s.mail == 0 and not next(s.claims) and redis.call('exists',KEYS[3]) == 0 then
    redis.call('del',KEYS[1])
  else redis.call('set', KEYS[1], encode(s)) end
  local active=next(s.claims) ~= nil
  for _,w in ipairs(s.waits) do if w.status == 'pending' or timed(w) then active=true end end
  if active then redis.call('sadd',KEYS[2],ARGV[6])
  else redis.call('srem',KEYS[2],ARGV[6]) end
  if redis.call('exists', KEYS[3]) == 1 then
    local revision=redis.call('incr',KEYS[5])
    redis.call('hset',KEYS[3],'__runRetentionRevision',tostring(revision))
    local metadata=redis.call('hget',KEYS[4],ARGV[6])
    if metadata then
      local m=cjson.decode(metadata); m.revision=revision
      redis.call('hset',KEYS[4],ARGV[6],encode(m))
    end
  end
  return encode(result)
end
if op == 'read' then return encode(s) end
if redis.call('hget',KEYS[3],'__runDeleting') == '1' then
  return redis.error_reply('Workflow run is being deleted')
end
if op == 'save' or op == 'save-owned' then
  if op == 'save-owned' then
    local status=redis.call('hget',KEYS[3],'status')
    if not status then return redis.error_reply('Workflow run not found') end
    local matches=false
    for _, allowed in ipairs(p.statuses) do if status == allowed then matches=true end end
    if not matches or redis.call('hget',KEYS[3],'workerId') ~= p.worker then return encode(false) end
  end
  for _,w in ipairs(s.waits) do
    if (w.status == 'pending' or w.claimedEventId or timed(w)) and sameNode(w,p.wait) then
      return encode(false)
    end
  end
  if #s.waits >= tonumber(ARGV[3]) then
    local evict=nil
    for i,w in ipairs(s.waits) do if w.status ~= 'pending' and not w.claimedAt then evict=i; break end end
    if not evict then return redis.error_reply('Event wait list full; unresolved waits cannot be evicted') end
    table.remove(s.waits,evict)
  end
  table.insert(s.waits,p.wait); return commit(true)
elseif op == 'resolve' then
  local w=findWait(p.id)
  if not w or w.status ~= 'pending' then return encode(false) end
  if p.name and mailIndex(p.name,p.cutoff) then return encode(false) end
  w.status=p.status
  if p.status == 'delivered' or p.status == 'expired' then w.claimedAt=now end
  return commit(true)
elseif op == 'restore-wait' then
  local w=findWait(p.id)
  if not w or (w.status ~= 'delivered' and w.status ~= 'expired') then return encode(false) end
  w.status='pending'; clearClaim(w); return commit(true)
elseif op == 'reserve-timeout' then
  local w=findWait(p.id)
  if not w or not timed(w) or (w.recoveryClaimedAt and w.recoveryClaimedAt > p.stale) then return encode(false) end
  w.recoveryClaimedAt=p.at; return commit(true)
elseif op == 'finalize-timeout' then
  local w=findWait(p.id)
  if w then w.claimedAt=nil; w.recoveryClaimedAt=nil; return commit(true) end
  return encode(false)
elseif op == 'append' then
  local claims=0; for _ in pairs(s.claims) do claims=claims+1 end
  if #s.mail + claims >= tonumber(ARGV[4]) then return redis.error_reply('Run event mailbox full; unconsumed events cannot be evicted') end
  local capacityError=reserveMailbox(); if capacityError then return capacityError end
  p.event.order=redis.call('incr',KEYS[7])
  table.insert(s.mail,p.event); return commit(true)
elseif op == 'remove' then
  for i,e in ipairs(s.mail) do if e.id == p.id then table.remove(s.mail,i); return commit(true) end end
  return encode(false)
elseif op == 'peek' or op == 'take' then
  local i=mailIndex(p.name,p.cutoff)
  if not i then return encode(cjson.null) end
  local e=s.mail[i]
  if op == 'take' then table.remove(s.mail,i); return commit(e) end
  return encode(e)
elseif op == 'claim' then
  local w=findWait(p.id)
  if not w or w.status ~= 'pending' then return encode(cjson.null) end
  local i=mailIndex(p.name,p.cutoff)
  if not i then return encode(cjson.null) end
  local e=table.remove(s.mail,i)
  w.status='delivered'; w.claimedAt=now; w.claimedEventId=e.id
  s.claims[e.id]={waitId=w.id,event=e,claimedAt=now}
  return commit(e)
elseif op == 'reserve-delivery' then
  local c=s.claims[p.eventId]
  if not c or c.waitId ~= p.id then return encode(false) end
  local w=findWait(p.id)
  if not w or (w.recoveryClaimedAt and w.recoveryClaimedAt > p.stale) then return encode(false) end
  w.recoveryClaimedAt=p.at; return commit(true)
elseif op == 'restore-event' then
  local c=s.claims[p.event.id]
  if c then restore(c.event); s.claims[p.event.id]=nil
  else
    restore(p.event)
  end
  return commit(true)
elseif op == 'restore-delivery' then
  local c=s.claims[p.eventId]
  if not c or c.waitId ~= p.id then return encode(false) end
  local w=findWait(p.id)
  local restored=w and (w.status == 'delivered' or w.status == 'expired') or false
  if restored then w.status='pending'; clearClaim(w) end
  restore(c.event); s.claims[p.eventId]=nil; return commit(restored)
elseif op == 'finalize-delivery' then
  local c=s.claims[p.eventId]
  if not c then return encode(false) end
  local w=findWait(c.waitId)
  if w then clearClaim(w); if p.delivered then w.deliveredEventId=p.eventId end end
  s.claims[p.eventId]=nil; return commit(true)

end
return redis.error_reply('Unknown workflow event-state operation')`;

interface StoredWait {
  value: string;
  id: string;
  nodeId: string;
  instance?: string;
  kind: string;
  status: string;
  claimedAt?: number;
  recoveryClaimedAt?: number;
  claimedEventId?: string;
  deliveredEventId?: string;
}
interface StoredEvent {
  value: string;
  id: string;
  name: string;
  at: number;
  order?: number;
}
interface StoredState {
  waits: StoredWait[];
  mail: StoredEvent[];
  claims: Record<string, { waitId: string; event: StoredEvent; claimedAt: number }>;
}
function eventValue(event: StoredEvent): RunEventEnvelope {
  const value = JSON.parse(event.value);
  const { payloadAbsent, ...envelope } = value;
  return {
    ...envelope,
    ...(payloadAbsent === true ? { payload: undefined } : {}),
    publishedAt: new Date(value.publishedAt),
  };
}
function waitValue(wait: StoredWait): PersistedPendingEventWait {
  const value = JSON.parse(wait.value);
  delete value.claimedAt;
  delete value.recoveryClaimedAt;
  delete value.claimedEventId;
  delete value.deliveredEventId;
  return {
    ...value,
    status: wait.status,
    requestedAt: new Date(value.requestedAt),
    ...(value.expiresAt ? { expiresAt: new Date(value.expiresAt) } : {}),
    ...(wait.claimedAt !== undefined ? { claimedAt: new Date(wait.claimedAt) } : {}),
    ...(wait.recoveryClaimedAt !== undefined
      ? { recoveryClaimedAt: new Date(wait.recoveryClaimedAt) }
      : {}),
    ...(wait.claimedEventId ? { claimedEventId: wait.claimedEventId } : {}),
    ...(wait.deliveredEventId ? { deliveredEventId: wait.deliveredEventId } : {}),
  };
}

/** Durable wait, mailbox and recovery mutations share one Redis turn. */
export class RedisEventWaitStore {
  constructor(
    private readonly client: RedisAdapter,
    private readonly prefix: string,
    private readonly strictContext = false,
  ) {}
  stateKey(runId: string): string {
    return `${this.prefix}event-state:${runId}`;
  }
  indexKey(): string {
    return `${this.prefix}index:event-state`;
  }
  private async command<T>(
    runId: string,
    operation: string,
    payload: unknown = {},
    reconciled = false,
  ): Promise<T> {
    try {
      const result = await this.client.eval(EVENT_STATE_SCRIPT, [
        this.stateKey(runId),
        this.indexKey(),
        `${this.prefix}run:${runId}`,
        `${this.prefix}index:terminal-completed-at-members`,
        `${this.prefix}index:terminal-retention-generation`,
        `${this.prefix}index:event-mailboxes`,
        `${this.prefix}event-publication-sequence`,
      ], [
        operation,
        JSON.stringify(payload),
        String(MAX_WORKFLOW_PENDING_EVENT_WAIT_ENTRIES),
        String(MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES),
        String(Date.now()),
        runId,
        String(MAX_WORKFLOW_RUN_EVENT_MAILBOXES),
        this.prefix,
      ]);
      if (typeof result !== "string") throw new Error("Invalid Redis event-state result");
      return JSON.parse(result) as T;
    } catch (cause) {
      if (
        !reconciled && cause instanceof Error &&
        cause.message.includes("Run event mailbox capacity reached")
      ) {
        try {
          await this.reconcileExistingMailboxes();
        } catch (reconciliationCause) {
          throw ORCHESTRATION_ERROR.create({
            detail: "Redis workflow mailbox reconciliation failed",
            cause: reconciliationCause,
          });
        }
        return await this.command<T>(runId, operation, payload, true);
      }
      if (cause instanceof Error && cause.message.includes("Workflow run not found")) {
        throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}`, cause });
      }
      throw ORCHESTRATION_ERROR.create({
        detail: "Redis workflow event-state operation failed",
        cause,
      });
    }
  }
  private async reconcileExistingMailboxes(): Promise<void> {
    await this.client.del(`${this.prefix}index:event-mailboxes:evictable`);
    let cursor = "0";
    do {
      const page = await this.client.eval(
        "local page=redis.call('zscan',KEYS[1],ARGV[1],'COUNT',50); local ids={}; for i=1,#page[2],2 do table.insert(ids,page[2][i]) end; return {page[1],ids}",
        [`${this.prefix}index:event-mailboxes`],
        [cursor],
      );
      if (
        !Array.isArray(page) || page.length !== 2 || typeof page[0] !== "string" ||
        !/^\d+$/.test(page[0]) || !Array.isArray(page[1]) ||
        !page[1].every((id): id is string => typeof id === "string")
      ) throw new Error("Invalid Redis mailbox index result");
      cursor = page[0];
      const ids: string[] = page[1];
      for (let offset = 0; offset < ids.length; offset += 50) {
        await this.client.eval(RECONCILE_EVENT_MAILBOXES_SCRIPT, [], [
          this.prefix,
          JSON.stringify(ids.slice(offset, offset + 50)),
        ]);
      }
    } while (cursor !== "0");
  }

  private async state(runId: string): Promise<StoredState> {
    try {
      const raw = await this.client.get(this.stateKey(runId));
      const state: StoredState = raw ? JSON.parse(raw) : { waits: [], mail: [], claims: {} };
      return {
        ...state,
        waits: Array.isArray(state.waits) ? state.waits : [],
        mail: Array.isArray(state.mail) ? state.mail : [],
      };
    } catch (cause) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Redis workflow event-state read failed",
        cause,
      });
    }
  }
  private storedWait(wait: PersistedPendingEventWait): StoredWait {
    const value = JSON.stringify({
      ...wait,
      requestedAt: wait.requestedAt.toISOString(),
      expiresAt: wait.expiresAt?.toISOString(),
      claimedAt: wait.claimedAt?.toISOString(),
      recoveryClaimedAt: wait.recoveryClaimedAt?.toISOString(),
    });
    return {
      value,
      id: wait.id,
      nodeId: wait.nodeId,
      instance: wait.waitInstanceId,
      kind: wait.waitKind,
      status: wait.status,
      claimedAt: wait.claimedAt?.getTime(),
      recoveryClaimedAt: wait.recoveryClaimedAt?.getTime(),
      claimedEventId: wait.claimedEventId,
      deliveredEventId: wait.deliveredEventId,
    };
  }
  private storedEvent(runId: string, event: RunEventEnvelope): StoredEvent {
    const publishedAt = event.publishedAt.toISOString();
    const payload = event.payload === undefined
      ? undefined
      : serializeWorkflowJson(event.payload, "workflow event payload", runId, {
        strictContext: this.strictContext,
      });
    const payloadFragment = payload === undefined ? `"payloadAbsent":true` : `"payload":${payload}`;
    const value = `{"id":${JSON.stringify(event.id)},"eventName":${
      JSON.stringify(event.eventName)
    },${payloadFragment},"publishedAt":${JSON.stringify(publishedAt)}}`;
    const order = (event as RunEventEnvelope & { _publicationOrder?: number })._publicationOrder;
    return { value, id: event.id, name: event.eventName, at: event.publishedAt.getTime(), order };
  }
  async savePendingEventWait(runId: string, wait: PersistedPendingEventWait): Promise<void> {
    await this.command(runId, "save", { wait: this.storedWait(wait) });
  }
  savePendingEventWaitIfStatusAndWorker(
    runId: string,
    statuses: WorkflowStatus[],
    worker: string,
    wait: PersistedPendingEventWait,
  ): Promise<boolean> {
    return this.command(runId, "save-owned", { statuses, worker, wait: this.storedWait(wait) });
  }
  async getPendingEventWaits(runId: string): Promise<PersistedPendingEventWait[]> {
    return (await this.state(runId)).waits.filter((w) => w.status === "pending").map(waitValue);
  }
  private async *states(runId?: string): AsyncGenerator<{ runId: string; state: StoredState }> {
    const ids = runId === undefined ? await this.client.smembers(this.indexKey()) : [runId];
    for (let offset = 0; offset < ids.length; offset += 50) {
      const batch = await Promise.all(
        ids.slice(offset, offset + 50).map(async (id) => ({
          runId: id,
          state: await this.state(id),
        })),
      );
      for (const entry of batch) yield entry;
    }
  }
  async listPendingEventWaits(): Promise<
    Array<{ runId: string; wait: PersistedPendingEventWait }>
  > {
    const result = [];
    for await (const { runId, state } of this.states()) {
      if (!await this.client.exists(`${this.prefix}run:${runId}`)) continue;
      for (const wait of state.waits) {
        if (wait.status === "pending") result.push({ runId, wait: waitValue(wait) });
      }
    }
    return result;
  }
  resolvePendingEventWait(
    runId: string,
    id: string,
    status: "delivered" | "expired" | "cancelled",
    unlessBuffered?: { eventName: string; publishedBefore: Date },
  ): Promise<boolean> {
    return this.command(runId, "resolve", {
      id,
      status,
      name: unlessBuffered?.eventName,
      cutoff: unlessBuffered?.publishedBefore.getTime(),
    });
  }
  restorePendingEventWait(runId: string, id: string): Promise<boolean> {
    return this.command(runId, "restore-wait", { id });
  }
  async listTimedEventWaitClaims(runId?: string): Promise<PersistedPendingEventWait[]> {
    const result: PersistedPendingEventWait[] = [];
    for await (const { state } of this.states(runId)) {
      result.push(
        ...state.waits.filter((w) =>
          w.claimedAt !== undefined &&
          ((w.kind === "delay" && w.status === "delivered") ||
            (w.kind === "event" && w.status === "expired"))
        ).map(waitValue),
      );
    }
    return result;
  }

  reserveTimedEventWaitClaim(runId: string, id: string, at: Date, stale: Date): Promise<boolean> {
    return this.command(runId, "reserve-timeout", { id, at: at.getTime(), stale: stale.getTime() });
  }
  async finalizeTimedEventWaitClaim(runId: string, id: string): Promise<void> {
    await this.command(runId, "finalize-timeout", { id });
  }
  async appendRunEvent(runId: string, event: RunEventEnvelope): Promise<void> {
    await this.command(runId, "append", { event: this.storedEvent(runId, event) });
  }
  removeRunEvent(runId: string, id: string): Promise<boolean> {
    return this.command(runId, "remove", { id });
  }
  async peekRunEvent(runId: string, name: string): Promise<RunEventEnvelope | null> {
    const event = await this.command<StoredEvent | null>(runId, "peek", { name });
    return event ? eventValue(event) : null;
  }
  async takeRunEvent(runId: string, name: string): Promise<RunEventEnvelope | null> {
    const event = await this.command<StoredEvent | null>(runId, "take", { name });
    // The same private marker used by MemoryBackend survives standalone rollback.
    if (!event) return null;
    const retainedEnvelope = { ...eventValue(event), _publicationOrder: event.order };
    return retainedEnvelope;
  }
  async claimRunEventForWait(
    runId: string,
    id: string,
    name: string,
    before?: Date,
  ): Promise<RunEventEnvelope | null> {
    const event = await this.command<StoredEvent | null>(runId, "claim", {
      id,
      name,
      cutoff: before?.getTime(),
    });
    return event ? eventValue(event) : null;
  }
  async listRunEventDeliveryClaims(runId?: string): Promise<RunEventDeliveryClaim[]> {
    const result: RunEventDeliveryClaim[] = [];
    for await (const { state } of this.states(runId)) {
      for (const claim of Object.values(state.claims)) {
        const wait = state.waits.find((w) => w.id === claim.waitId);
        if (!wait) throw ORCHESTRATION_ERROR.create({ detail: "Redis delivery claim has no wait" });
        result.push({
          wait: waitValue(wait),
          event: eventValue(claim.event),
          claimedAt: new Date(claim.claimedAt),
        });
      }
    }
    return result;
  }

  reserveRunEventDeliveryClaim(
    runId: string,
    id: string,
    eventId: string,
    at: Date,
    stale: Date,
  ): Promise<boolean> {
    return this.command(runId, "reserve-delivery", {
      id,
      eventId,
      at: at.getTime(),
      stale: stale.getTime(),
    });
  }
  async restoreRunEvent(runId: string, event: RunEventEnvelope): Promise<void> {
    await this.command(runId, "restore-event", { event: this.storedEvent(runId, event) });
  }
  restoreRunEventDelivery(runId: string, id: string, event: RunEventEnvelope): Promise<boolean> {
    return this.command(runId, "restore-delivery", { id, eventId: event.id });
  }
  async finalizeRunEventDelivery(
    runId: string,
    eventId: string,
    delivered: boolean,
  ): Promise<void> {
    await this.command(runId, "finalize-delivery", { eventId, delivered });
  }
  async hasRunEventDeliveryReceipt(runId: string, eventId: string): Promise<boolean> {
    return (await this.state(runId)).waits.some((w) => w.deliveredEventId === eventId);
  }
}
