/**
 * Node.js Redis Adapter
 *
 * Adapter for the Node.js 'redis' package.
 *
 * @module platform/adapters/redis/node
 */
/**
 * Adapter for Node.js 'redis' package
 */
export class NodeRedisAdapter {
    client;
    constructor(client) {
        this.client = client;
    }
    hset(key, fields) {
        return this.client.hSet(key, fields);
    }
    hgetall(key) {
        return this.client.hGetAll(key);
    }
    hdel(key, ...fields) {
        return this.client.hDel(key, fields);
    }
    del(...keys) {
        return this.client.del(keys);
    }
    sadd(key, ...members) {
        return this.client.sAdd(key, members);
    }
    srem(key, ...members) {
        return this.client.sRem(key, members);
    }
    smembers(key) {
        return this.client.sMembers(key);
    }
    rpush(key, ...values) {
        return this.client.rPush(key, values);
    }
    lrange(key, start, stop) {
        return this.client.lRange(key, start, stop);
    }
    lindex(key, index) {
        return this.client.lIndex(key, index);
    }
    lset(key, index, value) {
        return this.client.lSet(key, index, value);
    }
    llen(key) {
        return this.client.lLen(key);
    }
    xadd(key, id, fields) {
        return this.client.xAdd(key, id, fields);
    }
    xgroupCreate(key, group, id, mkstream) {
        return this.client.xGroupCreate(key, group, id, { MKSTREAM: mkstream });
    }
    async xreadgroup(streams, options) {
        const result = await this.client.xReadGroup(options.group, options.consumer, streams.map((s) => ({ key: s.key, id: s.xid })), { BLOCK: options.block, COUNT: options.count });
        if (!result)
            return [];
        // Normalize output
        // node-redis v4 returns: Array<{ name: string, messages: Array<{ id: string, message: Record<string, string> }> }>
        return result.map((stream) => ({
            key: stream.name,
            messages: stream.messages.map((msg) => ({ id: msg.id, data: msg.message })),
        }));
    }
    xack(key, group, ...ids) {
        return this.client.xAck(key, group, ids);
    }
    keys(pattern) {
        return this.client.keys(pattern);
    }
    exists(...keys) {
        return this.client.exists(keys);
    }
    expire(key, seconds) {
        return this.client.expire(key, seconds);
    }
    set(key, value, options) {
        const opts = {};
        if (options?.nx)
            opts.NX = true;
        if (options?.px)
            opts.PX = options.px;
        if (options?.ex)
            opts.EX = options.ex;
        return this.client.set(key, value, opts);
    }
    get(key) {
        return this.client.get(key);
    }
    async quit() {
        await this.client.quit();
    }
    async disconnect() {
        await this.client.disconnect();
    }
}
