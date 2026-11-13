export function normalize(value) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function fieldValues(team, field) {
    if (field === 'school') return [team.organization || '未填写学校'];
    if (field === 'participation') return [team.group?.includes('official') ? '正式参赛' : '非正式参赛'];
    if (field === 'name') return [team.name || ''];
    if (field === 'username') return [team.username || ''];
    if (field === 'id') return [team.team_id];
    return team.fields?.[field] || [];
}

// "正式参赛" is a substring of "非正式参赛"; match these labels from their start.
function textMatches(field, value, part) {
    return field === 'participation' ? value.startsWith(part) : value.includes(part);
}

export function matchesRule(team, rule) {
    const actual = fieldValues(team, rule.field).map(normalize).filter(Boolean);
    const wanted = (rule.values || []).map(normalize).filter(Boolean);
    const empty = !actual.length || (rule.field === 'school' && actual.every((value) => value === normalize('未填写学校')));
    if (rule.operator === 'empty') return empty;
    if (rule.operator === 'not-empty') return !empty;
    if (!wanted.length) return true;
    if (rule.operator === 'not') return actual.every((value) => !wanted.includes(value));
    if (rule.operator === 'contains') return actual.some((value) => wanted.some((part) => textMatches(rule.field, value, part)));
    return actual.some((value) => wanted.includes(value));
}

export function filterMembers(teams, { query = '', rules = [], mode = 'all' } = {}) {
    const keyword = normalize(query);
    const active = rules.filter((rule) => ['empty', 'not-empty'].includes(rule.operator) || rule.values?.some((value) => normalize(value)));
    return teams.filter((team) => {
        const searchable = [team.name, team.username, team.team_id, team.organization,
            ...Object.values(team.fields || {}).flat()].map(normalize).join('\n');
        if (keyword && !searchable.includes(keyword)
            && !fieldValues(team, 'participation').some((value) => textMatches('participation', normalize(value), keyword))) return false;
        return !active.length || (mode === 'any' ? active.some((rule) => matchesRule(team, rule)) : active.every((rule) => matchesRule(team, rule)));
    });
}

/** Applying a filter does not change selections until one of these explicit bulk operations is chosen. */
export function bulkSelection(selected, matches, operation) {
    const result = operation === 'replace' ? new Set() : new Set(selected);
    for (const team of matches) {
        if (operation === 'remove') result.delete(team.team_id);
        else result.add(team.team_id);
    }
    return result;
}
