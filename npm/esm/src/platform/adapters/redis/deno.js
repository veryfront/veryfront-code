import { arrayToObject } from "./utils.js";
export class DenoRedisAdapter {
    client;
    constructor(client) {
        this.client = client;
    }
    hset(key, fields) {
        return this.client.hset(key, fields);
    }
    async hgetall(key) {
        const res = await this.client.hgetall(key);
        // Deno redis returns array [k1, v1, k2, v2]
        return arrayToObject(res);
    }
    hdel(key, ...fields) {
        return this.client.hdel(key, ...fields);
    }
    del(...keys) {
        return this.client.del(...keys);
    }
    sadd(key, ...members) {
        return this.client.sadd(key, ...members);
    }
    srem(key, ...members) {
        return this.client.srem(key, ...members);
    }
    smembers(key) {
        return this.client.smembers(key);
    }
    rpush(key, ...values) {
        return this.client.rpush(key, ...values);
    }
    lrange(key, start, stop) {
        return this.client.lrange(key, start, stop);
    }
    lindex(key, index) {
        return this.client.lindex(key, index);
    }
    lset(key, index, value) {
        return this.client.lset(key, index, value);
    }
    llen(key) {
        return this.client.llen(key);
    }
    xadd(key, id, fields) {
        return this.client.xadd(key, id, fields);
    }
    xgroupCreate(key, group, id, mkstream) {
        return this.client.xgroupCreate(key, group, id, mkstream);
    }
    async xreadgroup(streams, options) {
        if (streams.length === 0)
            return [];
        const res = await this.client.xreadgroup(streams.map(({ key, xid }) => ({ key, xid })), options);
        if (!res)
            return [];
        return res.map((stream) => ({
            key: stream.key,
            messages: stream.messages.map((msg) => ({
                id: msg.id,
                data: arrayToObject(msg.fieldValues),
            })),
        }));
    }
    xack(key, group, ...ids) {
        return this.client.xack(key, group, ...ids);
    }
    keys(pattern) {
        return this.client.keys(pattern);
    }
    exists(...keys) {
        return this.client.exists(...keys);
    }
    expire(key, seconds) {
        return this.client.expire(key, seconds);
    }
    set(key, value, options) {
        return this.client.set(key, value, options);
    }
    get(key) {
        return this.client.get(key);
    }
    async quit() {
        await this.client.close(); // Deno redis uses close
    }
    async disconnect() {
        await this.client.close();
    }
}
