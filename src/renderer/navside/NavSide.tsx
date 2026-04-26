/**
 * NavSide — 框架壳（v1.4 NavSide 重构后）。
 *
 * 职责：
 *   - 顶部 BrandBar / ModeBar / ActionBar / SearchBar
 *   - 通过 panel-registry.getNavPanel(contentType) 分发到具体插件 Panel
 *
 * 不再处理任何 note 业务（folder/note 树渲染、拖拽、右键菜单、排序等
 * 全部下沉到 src/plugins/note/navside/）。
 *
 * 共 ~150 行（v1.3 时代 555 行）。
 */
import { useState } from 'react';
import { getNavPanel } from './panel-registry';
import { useWorkspaceSync } from './hooks/useWorkspaceSync';
import { activeStateStore } from './store/active-state-store';
import { styles } from './navside-styles';

declare const navSideAPI: {
  switchWorkMode: (id: string) => Promise<void>;
  closeRightSlot: () => Promise<void>;
  executeAction: (actionId: string, params?: Record<string, unknown>) => Promise<unknown>;
};

export function NavSide() {
  const ws = useWorkspaceSync();
  const [searchQuery, setSearchQuery] = useState('');

  const handleSwitchMode = (id: string) => {
    void navSideAPI.closeRightSlot();
    void navSideAPI.switchWorkMode(id);
  };

  const handleActionBarClick = (actionId: string) => {
    // 转发给当前 contentType 对应的插件（通过 executeAction IPC 路由到 plugin handler）
    void navSideAPI.executeAction(actionId).catch((err: unknown) => {
      console.warn('[NavSide] executeAction failed:', actionId, err);
    });
  };

  return (
    <div style={styles.container}>
      {/* Brand Bar */}
      <div style={styles.brandBar}>
        <img src="/logo.jpg" style={styles.brandLogo} alt="KRIG" />
        <span style={styles.brandName}>KRIG</span>
      </div>

      {/* ModeBar */}
      <div style={styles.modeBar} role="tablist" aria-label="工作模式">
        {ws.modes.map((mode) => (
          <button
            key={mode.id}
            role="tab"
            aria-selected={mode.id === ws.activeWorkModeId}
            style={{
              ...styles.modeTab,
              ...(mode.id === ws.activeWorkModeId ? styles.modeTabActive : {}),
            }}
            onClick={() => handleSwitchMode(mode.id)}
            title={mode.label}
            aria-label={mode.label}
          >
            <span style={styles.modeIcon}>{mode.icon}</span>
            <span style={styles.modeLabel}>{mode.label}</span>
          </button>
        ))}
      </div>

      {/* Action Bar */}
      <div style={styles.actionBar}>
        <span style={styles.actionTitle}>{ws.registration?.actionBar.title ?? ''}</span>
        <div style={styles.actionButtons}>
          {ws.registration?.actionBar.actions.map((action) => (
            <button
              key={action.id}
              style={styles.actionButton}
              onClick={() => handleActionBarClick(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div style={styles.search}>
        <input
          style={styles.searchInput}
          placeholder={
            ws.registration?.contentType === 'ebook-bookshelf' ? '搜索书架...'
            : ws.registration?.contentType === 'web-bookmarks' ? '搜索书签...'
            : ws.registration?.contentType === 'graph-list' ? '搜索图谱...'
            : '搜索...'
          }
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setSearchQuery(''); (e.target as HTMLInputElement).blur(); }
          }}
        />
      </div>

      {/* Content：分发到插件面板 */}
      {!ws.dbReady ? (
        <div style={styles.placeholder}>数据库启动中...</div>
      ) : ws.registration?.contentType ? (() => {
        const PanelComponent = getNavPanel(ws.registration.contentType);
        if (!PanelComponent) {
          return (
            <div style={styles.placeholder}>
              未注册的 contentType: {ws.registration.contentType}
            </div>
          );
        }
        return (
          <PanelComponent
            dbReady={ws.dbReady}
            // 兼容旧插件 props（EBook 等暂时还在用，M4 重构后清理）
            activeBookId={null}
            initialExpandedFolders={[]}
            onActiveBookChange={(id: string | null) => activeStateStore.setActiveBookIdLocal(id)}
          />
        );
      })() : (
        <div style={styles.placeholder}>请选择工作模式</div>
      )}
    </div>
  );
}
