/**
 * AIServicesPanel — AI 服务选择面板
 *
 * 在 NavSide 中显示 AI 服务列表（ChatGPT / Claude / Gemini），
 * 用于 ai-sync WorkMode。
 */

import { getAIServiceList } from '../../../shared/types/ai-service-types';

export function AIServicesPanel() {
  const services = getAIServiceList();

  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ color: '#888', fontSize: 11, marginBottom: 12 }}>
        在左侧 AI 页面中直接对话，对话内容会实时同步到右侧 Note。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {services.map(s => (
          <div
            key={s.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', borderRadius: 6,
              background: '#2a2a2a', color: '#e8eaed', fontSize: 13,
            }}
          >
            <span style={{ fontSize: 16 }}>{s.icon}</span>
            <span>{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
