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

    /**
     * Helper to create a nested parent/child TabRef node supporting arbitrary depth.
     * @param {string} rootLabel Root tab label (e.g. 'economy', 'components')
     * @param {...string} subLabels Sub tab labels (e.g. 'standard', 'action')
     * @returns {TabRef}
     */
    static from(rootLabel, ...subLabels) {
        const filteredSubs = subLabels.filter(s => s && s !== 'none');
        if (filteredSubs.length === 0) {
            return new TabRef({ label: rootLabel });
        }
        let current = new TabRef({ label: rootLabel });
        for (const sub of filteredSubs) {
            current = new TabRef({ label: sub, parent: current });
        }
        return current;
    }
}

