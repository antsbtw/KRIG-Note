/**
 * ImportModal — eBook 导入选项弹窗（v1.4 NavSide 重构 M4）。
 *
 * 显示选中的文件名 + 两种存储模式（managed / link）单选。
 * 业务回调由 useEBookOperations 提供。
 */
import type { CSSProperties } from 'react';

interface Props {
  fileName: string;
  storage: 'managed' | 'link';
  onStorageChange: (s: 'managed' | 'link') => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImportModal({ fileName, storage, onStorageChange, onConfirm, onCancel }: Props) {
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>导入电子书</div>
        <div style={styles.fileName}>📄 {fileName}</div>

        <label style={styles.radioLabel}>
          <input
            type="radio"
            name="ebook-storage"
            checked={storage === 'managed'}
            onChange={() => onStorageChange('managed')}
          />
          <div>
            <div style={styles.radioTitle}>拷贝到 KRIG 管理（推荐）</div>
            <div style={styles.radioDesc}>文件将被复制到 KRIG 的资料库中，不会因为原文件移动或删除而丢失。</div>
          </div>
        </label>

        <label style={styles.radioLabel}>
          <input
            type="radio"
            name="ebook-storage"
            checked={storage === 'link'}
            onChange={() => onStorageChange('link')}
          />
          <div>
            <div style={styles.radioTitle}>链接原文件</div>
            <div style={styles.radioDesc}>仅记录文件路径，不复制文件。移动或删除原文件后将无法打开。</div>
          </div>
        </label>

        <div style={styles.actions}>
          <button style={styles.btnCancel} onClick={onCancel}>取消</button>
          <button style={styles.btnConfirm} onClick={onConfirm}>导入</button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  modal: {
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: 10,
    padding: '20px 24px',
    width: 360,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: '#e8eaed',
    marginBottom: 12,
  },
  fileName: {
    fontSize: 13,
    color: '#ccc',
    padding: '8px 10px',
    background: '#333',
    borderRadius: 6,
    marginBottom: 16,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '8px 0',
    cursor: 'pointer',
  },
  radioTitle: {
    fontSize: 13,
    color: '#e8eaed',
    fontWeight: 500,
  },
  radioDesc: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
    lineHeight: '1.4',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 18,
  },
  btnCancel: {
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: 6,
    color: '#ccc',
    fontSize: 13,
    padding: '6px 16px',
    cursor: 'pointer',
  },
  btnConfirm: {
    background: '#3b82f6',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 13,
    padding: '6px 16px',
    cursor: 'pointer',
  },
};
