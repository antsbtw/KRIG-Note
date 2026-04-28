/**
 * Inspector — 画板编辑器浮窗。
 *
 * 两个 Tab：
 *   布局  全图布局参数（方向 / 边样式 / 间距）
 *   属性  选中点/边的属性（substance / 视觉 override）
 *
 * 设计原则：
 *   - 用户主动切 Tab，不做自动跳转（选中态变化时保持当前 Tab）
 *   - 库（user substance 管理）从 Tab 中移除：picker 弹独立浮窗承载选择，管理动作待加
 *
 * 位置：固定右侧，绝对定位浮在画布上（不挤压画布）。
 */
import { useState } from 'react';
import type {
  GraphGeometryRecord,
  GraphIntensionAtomRecord,
  GraphPresentationAtomRecord,
} from '../../../main/storage/types';
import { LayoutInspectorTab } from './inspector/LayoutInspectorTab';
import { PropertiesInspectorTab } from './inspector/PropertiesInspectorTab';

export type InspectorTab = 'layout' | 'properties';

export interface InspectorProps {
  /** 当前 graph id（图谱级 atom 写入用） */
  graphId: string | null;
  /** 当前 layout id（图谱级 atom 写入用） */
  layoutId: string;
  /** 当前选中节点 ids（属性 Tab 内容） */
  selectedIds: ReadonlySet<string>;
  /** 当前生效的图谱级 layout 参数（用于按钮"亮"哪个状态显示） */
  layoutOptions: Record<string, string>;
  /** 原始 atom 数据（属性 Tab 读取当前 substance / 视觉 override） */
  geometries: GraphGeometryRecord[];
  intensions: GraphIntensionAtomRecord[];
  presentations: GraphPresentationAtomRecord[];
  /** 写入图谱级 layout 参数 atom（reload 由调用方触发） */
  onSetLayoutOption: (attribute: string, value: string) => Promise<void>;
  /** 替换 N 个节点的 substance（单选传 [id]，多选传所有选中） */
  onReplaceSubstance: (geometryIds: string[], newSubstanceId: string) => Promise<void>;
  /** 写 N 个节点的视觉 override（layout_id='*'） */
  onSetVisualOverride: (geometryIds: string[], attribute: string, value: string) => Promise<void>;
  /** 删除 N 个节点的视觉 override（重置为 substance 默认值） */
  onClearVisualOverride: (geometryIds: string[], attribute: string) => Promise<void>;
  /** 凝结选中几何体为新的 user 层 substance */
  onForgeSubstance: (geometryIds: string[]) => Promise<void>;
}

export function Inspector({
  graphId,
  layoutId,
  selectedIds,
  layoutOptions,
  geometries,
  intensions,
  presentations,
  onSetLayoutOption,
  onReplaceSubstance,
  onSetVisualOverride,
  onClearVisualOverride,
  onForgeSubstance,
}: InspectorProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorTab>('layout');

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
        {(['layout', 'properties'] as InspectorTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              ...tabButtonStyle,
              ...(activeTab === tab ? tabButtonActiveStyle : {}),
            }}
          >
            {TAB_LABELS[tab]}
            {tab === 'properties' && selectedIds.size > 0 && (
              <span style={tabBadgeStyle}>{selectedIds.size}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div style={tabContentStyle}>
        {activeTab === 'layout' && (
          <LayoutInspectorTab
            graphId={graphId}
            layoutId={layoutId}
            selectedIds={selectedIds}
            layoutOptions={layoutOptions}
            geometries={geometries}
            intensions={intensions}
            presentations={presentations}
            onSetLayoutOption={onSetLayoutOption}
            onReplaceSubstance={onReplaceSubstance}
            onSetVisualOverride={onSetVisualOverride}
            onClearVisualOverride={onClearVisualOverride}
            onForgeSubstance={onForgeSubstance}
          />
        )}
        {activeTab === 'properties' && (
          <PropertiesInspectorTab selectedIds={selectedIds} />
        )}
      </div>
    </div>
  );
}

const TAB_LABELS: Record<InspectorTab, string> = {
  layout: '布局',
  properties: '属性',
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
