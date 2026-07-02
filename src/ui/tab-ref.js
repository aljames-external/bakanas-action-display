/**
 * Structured tab reference node that pre-computes and caches its root parent ID
 * and hierarchy path string at construction.
 */
export class TabRef {
    /**
     * @param {Object} options
     * @param {string} options.label Tab identifier/label (e.g. 'action', 'evocation', 'vocal')
     * @param {TabRef|null} [options.parent=null] Parent TabRef node in the tree
     */
    constructor({ label, parent = null } = {}) {
        this.label = label;
        this.parent = parent;

        // Pre-compute and cache root ID and path string for O(1) high-performance lookups
        this.root = parent ? parent.root : label;
        this.path = parent ? `${parent.path}/${label}` : label;
    }
}
