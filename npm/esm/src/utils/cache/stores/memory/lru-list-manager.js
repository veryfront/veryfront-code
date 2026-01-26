export class LRUListManager {
    head = null;
    tail = null;
    getHead() {
        return this.head;
    }
    getTail() {
        return this.tail;
    }
    moveToFront(node) {
        node.entry.lastAccessed = Date.now();
        if (node === this.head) {
            return;
        }
        this.removeNode(node);
        this.addToFront(node);
    }
    addToFront(node) {
        node.next = this.head;
        node.prev = null;
        if (this.head) {
            this.head.prev = node;
        }
        else {
            this.tail = node;
        }
        this.head = node;
        node.entry.lastAccessed = Date.now();
    }
    removeNode(node) {
        if (node.prev) {
            node.prev.next = node.next;
        }
        else if (node === this.head) {
            this.head = node.next;
        }
        if (node.next) {
            node.next.prev = node.prev;
        }
        else if (node === this.tail) {
            this.tail = node.prev;
        }
    }
    clear() {
        this.head = null;
        this.tail = null;
    }
}
