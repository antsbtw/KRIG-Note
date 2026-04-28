/**
 * Inspector — 画板编辑器浮窗（B4.2.a 框架）。
 *
 * 画板模型核心 UI：用户在自动布局产物上做调整的入口。
 * 三个 Tab 按"作用域"分（不是按"功能"）：
 *
 *   画板  无需选中，编辑全图属性（方向 / 间距 / 边样式 / ...）
 *   节点  选中节点/边后，编辑 substance / 视觉覆盖（B4.2.b 实施）
 *   文字  选中节点后，编辑 label 内容 / 公式（推后到 v1.5+）
 *
 * 位置：固定右侧，绝对定位浮在画布上（不挤压画布）。
 * 状态：默认展开（首次使用易发现）；用户折叠后保留细边条作为入口。
 *
 * 详见 docs/graph/KRIG-Graph-Canvas-Spec.md §2 + §3
 */
import { useEffect, useState } from 'react';
import { CanvasInspectorTab } from './inspector/CanvasInspectorTab';

export type InspectorTab = 'canvas' | 'node' | 'text';

export interface InspectorProps {
  /** 当前 graph id（图谱级 atom 写入用） */
  graphId: string | null;
  /** 当前 layout id（图谱级 atom 写入用） */
  layoutId: string;
  /** 当前选中节点 ids（决定默认 Tab + 节点 Tab 内容） */
  selectedIds: ReadonlySet<string>;
  /** 当前生效的图谱级 layout 参数（用于按钮"亮"哪个状态显示） */
  layoutOptions: Record<string, string>;
  /** 写入图谱级 layout 参数 atom（reload 由调用方触发） */
  onSetLayoutOption: (attribute: string, value: string) => Promise<void>;
}

export function Inspector({ graphId, layoutId, selectedIds, layoutOptions, onSetLayoutOption }: InspectorProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorTab>('canvas');

  // 选中变化时，自动切到合适 Tab（仅当用户从"无选中→有选中"时跳转）
  // 避免反复打架：用户主动切 Tab 后不再被覆盖
  const [userOverrideTab, setUserOverrideTab] = useState(false);
  useEffect(() => {
    if (userOverrideTab) return;
    if (selectedIds.size > 0 && activeTab === 'canvas') {
      setActiveTab('node');
    } else if (selectedIds.size === 0 && activeTab !== 'canvas') {
      setActiveTab('canvas');
    }
  }, [selectedIds, activeTab, userOverrideTab]);

  const handleTabClick = (tab: InspectorTab) => {
    setActiveTab(tab);
    setUserOverrideTab(true);
  };

  if (!graphId) return null;

  // 折叠态：仅显示一个细窄边条作为入口
  if (collapsed) {
    return (
      <div
        onClick={() => setCollapsed(false)}
        title="展开 Inspector"
        style={collapsedBarStyle}
      >
        <div style={{ writingMode: 'vertical-rl', fontSize: 11, opacity: 0.7 }}>
          编辑器
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      {/* 标题栏 + 折叠按钮 */}
      <div style={titleBarStyle}>
        <span style={{ fontSize: 12, color: '#bbb', fontWeight: 500 }}>编辑器</span>
        <button
          onClick={() => setCollapsed(true)}
          title="收起"
          style={collapseButtonStyle}
        >
          ›
        </button>
      </div>

      {/* Tab 栏 */}
      <div style={tabBarStyle}>
        {(['canvas', 'node', 'text'] as InspectorTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabClick(tab)}
            style={{
              ...tabButtonStyle,
              ...(activeTab === tab ? tabButtonActiveStyle : {}),
            }}
          >
            {TAB_LABELS[tab]}
            {tab === 'node' && selectedIds.size > 0 && (
              <span style={tabBadgeStyle}>{selectedIds.size}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div style={tabContentStyle}>
        {activeTab === 'canvas' && (
          <CanvasInspectorTab
            graphId={graphId}
            layoutId={layoutId}
            layoutOptions={layoutOptions}
            onSetLayoutOption={onSetLayoutOption}
          />
        )}
        {activeTab === 'node' && (
          <div style={placeholderStyle}>
            {selectedIds.size === 0
              ? '点击节点以编辑'
              : `已选 ${selectedIds.size} 个节点（编辑功能 B4.2.b 实装）`}
          </div>
        )}
        {activeTab === 'text' && (
          <div style={placeholderStyle}>
            文字 / 公式编辑推后到后续阶段
          </div>
        )}
      </div>
    </div>
  );
}

const TAB_LABELS: Record<InspectorTab, string> = {
  canvas: '画板',
  node: '节点',
  text: '文字',
};

const PANEL_WIDTH = 260;

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 56,
  right: 12,
  width: PANEL_WIDTH,
  maxHeight: 'calc(100% - 80px)',
  display: 'flex',
  flexDirection: 'column',
  background: 'rgba(20, 20, 22, 0.95)',
  border: '1px solid #333',
  borderRadius: 6,
  zIndex: 10,
  overflow: 'hidden',
  userSelect: 'none',
  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
};

const collapsedBarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 56,
  right: 0,
  width: 18,
  height: 80,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(20, 20, 22, 0.85)',
  borderTopLeftRadius: 6,
  borderBottomLeftRadius: 6,
  borderLeft: '1px solid #333',
  borderTop: '1px solid #333',
  borderBottom: '1px solid #333',
  cursor: 'pointer',
  zIndex: 10,
  color: '#bbb',
};

const titleBarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 10px',
  borderBottom: '1px solid #2a2a2a',
};

const collapseButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#bbb',
  fontSize: 16,
  cursor: 'pointer',
  padding: '0 4px',
  lineHeight: 1,
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid #2a2a2a',
};

const tabButtonStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  color: '#888',
  fontSize: 12,
  padding: '8px 0',
  cursor: 'pointer',
  outline: 'none',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 4,
};

const tabButtonActiveStyle: React.CSSProperties = {
  color: '#e8eaed',
  borderBottomColor: '#3b82f6',
};

const tabBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  background: '#3b82f6',
  color: '#fff',
  padding: '0 5px',
  borderRadius: 8,
  lineHeight: '14px',
};

const tabContentStyle: React.CSSProperties = {
  padding: 10,
  overflowY: 'auto',
  flex: 1,
};

const placeholderStyle: React.CSSProperties = {
  color: '#666',
  fontSize: 12,
  padding: '20px 0',
  textAlign: 'center',
  fontStyle: 'italic',
};
