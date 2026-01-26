export class LRUNode {
    key;
    entry;
    prev;
    next;
    constructor(key, entry, prev = null, next = null) {
        this.key = key;
        this.entry = entry;
        this.prev = prev;
        this.next = next;
    }
}
