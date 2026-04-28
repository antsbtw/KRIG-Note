/**
 * 布局 Tab — 合并全图布局参数 + 选中节点视觉。
 *
 * 上下两栏（用一条分隔线隔开，无标注；用户看就懂）：
 *   上栏  CanvasInspectorTab — 全图布局参数（方向/边样式/间距）
 *   下栏  NodeInspectorTab    — 选中节点的视觉（substance/W×H/填充/描边/形状/Label）
 *                                未选中时显示空状态提示
 */
import type {
  GraphGeometryRecord,
  GraphIntensionAtomRecord,
  GraphPresentationAtomRecord,
} from '../../../../main/storage/types';
import { CanvasInspectorTab } from './CanvasInspectorTab';
import { NodeInspectorTab } from './NodeInspectorTab';

export interface LayoutInspectorTabProps {
  graphId: string;
  layoutId: string;
  selectedIds: ReadonlySet<string>;
  layoutOptions: Record<string, string>;
  geometries: GraphGeometryRecord[];
  intensions: GraphIntensionAtomRecord[];
  presentations: GraphPresentationAtomRecord[];
  onSetLayoutOption: (attribute: string, value: string) => Promise<void>;
  onReplaceSubstance: (geometryIds: string[], newSubstanceId: string) => Promise<void>;
  onSetVisualOverride: (geometryIds: string[], attribute: string, value: string) => Promise<void>;
  onClearVisualOverride: (geometryIds: string[], attribute: string) => Promise<void>;
  onForgeSubstance: (geometryIds: string[]) => Promise<void>;
}

export function LayoutInspectorTab(props: LayoutInspectorTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <CanvasInspectorTab
        graphId={props.graphId}
        layoutId={props.layoutId}
        layoutOptions={props.layoutOptions}
        onSetLayoutOption={props.onSetLayoutOption}
      />
      <div style={dividerStyle} />
      <NodeInspectorTab
        graphId={props.graphId}
        layoutId={props.layoutId}
        selectedIds={props.selectedIds}
        geometries={props.geometries}
        intensions={props.intensions}
        presentations={props.presentations}
        onReplaceSubstance={props.onReplaceSubstance}
        onSetVisualOverride={props.onSetVisualOverride}
        onClearVisualOverride={props.onClearVisualOverride}
        onForgeSubstance={props.onForgeSubstance}
      />
    </div>
  );
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: '#2a2a2a',
  margin: '14px 0',
};
