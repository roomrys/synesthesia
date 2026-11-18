// LayerFinder: no layers yet, just one per ensemble member. This lets stage 1
// run on its own; bar-nmf and others come with stage 2.

export default {
    id: 'none',
    name: 'One layer per instrument',
    description: 'Every candidate of a member is in that member\'s layer.',
    defaults: {},

    find(candidates, { ensemble } = {}) {
        return ensemble.map((member, index) => ({
            id: member.label,
            kind: 'member',
            members: new Map(candidates.flatMap((c, k) => (c.member === index ? [[k, 1]] : []))),
            occurrences: [],
        }));
    },
};
