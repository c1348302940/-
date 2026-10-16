/** 将成员、版本、任务和步骤整理成 2D / 3D 共用的进度矩阵。 */

function statusMatches(task, filter, today) {
  if (!filter || filter === 'all') return true;
  if (filter === 'open') return task.status !== 'done';
  if (filter === 'overdue') return task.status !== 'done' && !!task.due_date && task.due_date < today;
  return task.status === filter;
}

function progressLevel(total, rate) {
  if (!total) return 0;
  if (rate === 0) return 1;
  if (rate < 50) return 2;
  if (rate < 100) return 3;
  return 4;
}

export function buildTeamProgressMatrix({
  members = [],
  versions = [],
  tasks = [],
  steps = [],
  today = '',
  versionFilter = 'all',
  statusFilter = 'all',
  query = '',
}) {
  const columns = versions.map((version) => ({ ...version, id: String(version.id) }));
  columns.push({ id: 'none', name: '未关联版本', color: '#aeb5c2', unlinked: true });
  const shownColumns = versionFilter === 'all'
    ? columns
    : columns.filter((column) => column.id === String(versionFilter));
  const memberIds = new Set(members.map((member) => String(member.id)));
  const memberTasks = tasks.filter((task) => memberIds.has(String(task.assignee_id)));
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const filterActive = statusFilter !== 'all' || !!normalizedQuery;
  const stepMap = new Map();
  for (const step of steps) {
    const key = String(step.task_id);
    const value = stepMap.get(key) || { done: 0, total: 0 };
    value.total++;
    if (step.done === 1 || step.done === true) value.done++;
    stepMap.set(key, value);
  }

  const rows = members.map((member) => {
    const cells = shownColumns.map((column) => {
      const cellTasks = memberTasks.filter((task) =>
        String(task.assignee_id) === String(member.id)
        && (column.unlinked ? !task.version_id : String(task.version_id) === column.id));
      const done = cellTasks.filter((task) => task.status === 'done').length;
      const doing = cellTasks.filter((task) => task.status === 'doing').length;
      const todo = cellTasks.filter((task) => task.status === 'todo').length;
      const overdue = cellTasks.filter((task) =>
        task.status !== 'done' && !!task.due_date && task.due_date < today).length;
      const rate = cellTasks.length ? Math.round(done / cellTasks.length * 100) : 0;
      let stepDone = 0;
      let stepTotal = 0;
      for (const task of cellTasks) {
        const counts = stepMap.get(String(task.id));
        if (counts) { stepDone += counts.done; stepTotal += counts.total; }
      }
      const matching = cellTasks.filter((task) =>
        statusMatches(task, statusFilter, today)
        && (!normalizedQuery
          || String(task.title || '').toLowerCase().includes(normalizedQuery)
          || String(task.description || '').toLowerCase().includes(normalizedQuery)));
      return {
        memberId: String(member.id),
        memberName: member.name || '',
        memberColor: member.color || '#8494ad',
        versionId: column.id,
        versionName: column.name || '',
        versionColor: column.color || '#6a7ae0',
        total: cellTasks.length,
        todo,
        doing,
        done,
        overdue,
        rate,
        level: progressLevel(cellTasks.length, rate),
        stepDone,
        stepTotal,
        matchCount: matching.length,
        dimmed: filterActive && matching.length === 0,
      };
    });
    return { member, cells };
  });

  return { columns: shownColumns, rows, filterActive };
}
