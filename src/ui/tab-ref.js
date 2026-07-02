/**
 * Structured tab reference node that pre-computes and caches its root parent ID
 * and hierarchy path string at construction.
 */
export class TabRef {
    /**
     * @param {Object} options
     * @param {string} options.id Tab identifier (e.g. 'action', 'evocation', 'vocal')
     * @param {string} [options.label] Display label (e.g. 'Action', 'Evocation', 'Vocal')
     * @param {TabRef|null} [options.parent=null] Parent TabRef node in the tree
     */
    constructor({ id, label = '', parent = null } = {}) {
        this.id = id;
        this.label = label;
        this.parent = parent;

        // Pre-compute and cache root ID and path string for O(1) high-performance lookups
        this.root = parent ? parent.root : id;
        this.path = parent ? `${parent.path}/${id}` : id;
    }

    /**
     * Direct parent tab ID if one exists, otherwise the root parent ID.
     * @type {string}
     */
    get parentId() {
        return this.parent ? this.parent.id : this.id;
    }

    /**
     * Custom JSON serialization.
     * @returns {string}
     */
    toJSON() {
        return this.path;
    }
}
