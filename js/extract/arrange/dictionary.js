// The dictionary: one template per sound of every ensemble member. Pure.

/**
 * Render every sound of every member with its timbre, scaled to unit length.
 * @param {import('./types.js').Member[]} members
 * @param {import('./types.js').Axis} axis
 * @returns {import('./types.js').Dictionary}
 */
export function buildDictionary(members, axis) {
    const columns = [];
    const labels = [];
    members.forEach((member, index) => {
        for (const sound of member.instrument.sounds(member.options)) {
            const column = Float32Array.from(member.timbre.render(member, sound, axis));
            let norm = 0;
            for (const v of column) {
                if (!(v >= 0)) throw new Error(`timbre "${member.timbre.id}" rendered a negative or invalid value`);
                norm += v * v;
            }
            norm = Math.sqrt(norm);
            if (norm === 0) continue;   // nothing on this axis (e.g. above its top)
            for (let i = 0; i < column.length; i++) column[i] /= norm;
            columns.push(column);
            labels.push({ member: index, sound });
        }
    });
    return { hz: axis.hz, columns, labels };
}
