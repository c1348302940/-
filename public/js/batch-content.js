import { esc, toast } from './util.js';
import { store, mutate } from './api.js';
import { openModal, closeModal } from './ui.js';
import { validateBatchItems, runBatchCreate } from './batch-ops.js';

const MAX_ITEMS = 20;

/**
 * 统一的批量新增弹窗。编辑已有内容仍走各模块原有的单条编辑流程。
 */
export function openBatchContentModal(config) {
  openModal({
    title: config.title,
    wide: true,
    body: `<div class="batch-intro">一次可以填写多条${esc(config.itemLabel)}，每条内容都可以单独设置关联信息。</div>
      <div class="batch-list" data-batch-list></div>
      <button class="btn ghost batch-add" type="button" data-batch-act="add">＋ 继续添加一条</button>`,
    footer: `<span class="batch-count" data-batch-count>共 1 条</span>
      <span class="spacer"></span>
      <button class="btn" data-act="close-modal">取消</button>
      <button class="btn" type="button" data-batch-save="draft">保存 1 条草稿</button>
      <button class="btn primary" type="button" data-batch-save="publish">保存并发布 1 条</button>`,
    onMount(modal) {
      const list = modal.querySelector('[data-batch-list]');
      const addButton = modal.querySelector('[data-batch-act="add"]');
      const draftButton = modal.querySelector('[data-batch-save="draft"]');
      const publishButton = modal.querySelector('[data-batch-save="publish"]');
      let busy = false;

      const rows = () => Array.from(list.querySelectorAll('[data-batch-item]'));

      const itemHtml = (values = {}) => `<section class="batch-item" data-batch-item>
        <div class="batch-item-head">
          <strong data-batch-number></strong>
          <span class="spacer"></span>
          <button class="btn sm ghost" type="button" data-batch-act="duplicate">复制本条</button>
          <button class="btn sm ghost danger" type="button" data-batch-act="remove">删除</button>
        </div>
        <div class="form-grid">${config.renderFields(values)}</div>
      </section>`;

      const refresh = () => {
        const all = rows();
        all.forEach((row, index) => {
          row.querySelector('[data-batch-number]').textContent = `第 ${index + 1} 条`;
          row.querySelector('[data-batch-act="remove"]').disabled = all.length === 1;
        });
        modal.querySelector('[data-batch-count]').textContent = `共 ${all.length} 条`;
        draftButton.textContent = `保存 ${all.length} 条草稿`;
        publishButton.textContent = `保存并发布 ${all.length} 条`;
        addButton.disabled = all.length >= MAX_ITEMS;
        addButton.textContent = all.length >= MAX_ITEMS ? `一次最多添加 ${MAX_ITEMS} 条` : '＋ 继续添加一条';
      };

      const append = (values = {}, focus = true) => {
        list.insertAdjacentHTML('beforeend', itemHtml(values));
        refresh();
        const row = rows().at(-1);
        if (focus) {
          row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          row.querySelector('input, textarea, select')?.focus();
        }
      };

      append({}, false);
      rows()[0].querySelector('input, textarea, select')?.focus();

      list.addEventListener('click', (event) => {
        if (busy) return;
        const button = event.target.closest('[data-batch-act]');
        if (!button) return;
        const row = button.closest('[data-batch-item]');
        if (button.dataset.batchAct === 'remove' && rows().length > 1) {
          row.remove();
          refresh();
        }
        if (button.dataset.batchAct === 'duplicate' && rows().length < MAX_ITEMS) {
          append(config.readItem(row));
        }
      });

      addButton.addEventListener('click', () => {
        if (!busy && rows().length < MAX_ITEMS) append();
      });

      const setBusy = (value) => {
        busy = value;
        modal.querySelectorAll('button').forEach((button) => { button.disabled = value; });
      };

      const save = async (publish) => {
        if (busy) return;
        const items = rows().map((row) => config.readItem(row));
        const invalid = validateBatchItems(items, config.validateItem);
        if (invalid) {
          toast(invalid.message, 'err');
          const row = rows()[invalid.index];
          row.classList.add('invalid');
          row.scrollIntoView({ block: 'center', behavior: 'smooth' });
          setTimeout(() => row.classList.remove('invalid'), 1800);
          return;
        }

        setBusy(true);
        try {
          const result = await runBatchCreate({
            items,
            initialIds: (store.state[config.listKey] || []).map((row) => row.id),
            createItem: (item) => mutate(config.createAction, item),
            publishItem: publish
              ? (id, item) => mutate(config.publishAction, { id, [config.titleKey]: item[config.titleKey] })
              : null,
            listFromState: (state) => state[config.listKey],
            onProgress({ phase, index, total }) {
              const label = phase === 'create' ? '正在保存' : '正在发布';
              (publish ? publishButton : draftButton).textContent = `${label} ${index + 1}/${total}`;
            },
          });
          await config.onComplete?.({ publish, items, ...result });
          toast(publish
            ? `已发布 ${items.length} 条${config.itemLabel}`
            : `已保存 ${items.length} 条草稿（成员不可见）`, 'ok');
          closeModal();
        } catch (_) {
          // mutate 已给出具体错误提示；保留弹窗内容便于检查。
          setBusy(false);
          refresh();
        }
      };

      draftButton.addEventListener('click', () => save(false));
      publishButton.addEventListener('click', () => save(true));
    },
  });
}
