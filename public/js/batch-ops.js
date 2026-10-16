/** 批量新增内容的纯业务辅助函数，独立于 DOM，便于验证保存顺序与新记录识别。 */

export function validateBatchItems(items, validateItem) {
  for (let index = 0; index < items.length; index++) {
    const message = validateItem(items[index], index);
    if (message) return { index, message: `第 ${index + 1} 条：${message}` };
  }
  return null;
}

export async function runBatchCreate({
  items,
  initialIds,
  createItem,
  publishItem,
  listFromState,
  onProgress,
}) {
  const knownIds = new Set(initialIds || []);
  const createdIds = [];
  const publishStates = [];

  for (let index = 0; index < items.length; index++) {
    onProgress?.({ phase: 'create', index, total: items.length });
    const createState = await createItem(items[index], index);
    const created = (listFromState(createState) || []).find((row) => !knownIds.has(row.id));
    if (!created) throw new Error(`第 ${index + 1} 条保存后未能识别新记录，请刷新页面检查`);
    knownIds.add(created.id);
    createdIds.push(created.id);

    if (publishItem) {
      onProgress?.({ phase: 'publish', index, total: items.length });
      publishStates.push(await publishItem(created.id, items[index], index));
    }
  }

  return { createdIds, publishStates };
}
