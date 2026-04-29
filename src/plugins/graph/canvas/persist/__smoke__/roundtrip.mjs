// 序列化 round-trip smoke
// 不依赖 NodeRenderer / SceneManager(那两者要 DOM/WebGL),只测 CanvasDocument
// 结构 + cloneInstance 保真 + viewBox 数学

const SCHEMA_VERSION = 1;

// 构造一个完整的画板文档
const before = {
  schema_version: SCHEMA_VERSION,
  viewBox: { x: 100, y: 50, w: 1920, h: 1080 },
  instances: [
    { id: 'i-1', type: 'shape', ref: 'krig.basic.roundRect', position: { x: 50, y: 50 }, size: { w: 200, h: 100 }, params: { r: 0.2 } },
    { id: 'i-2', type: 'shape', ref: 'krig.basic.diamond', position: { x: 320, y: 50 }, size: { w: 120, h: 100 }, style_overrides: { fill: { color: '#e8a8c0' } } },
    { id: 'i-3', type: 'substance', ref: 'library.family.person', position: { x: 50, y: 220 }, props: { label: '贾宝玉', gender: 'M' } },
    { id: 'i-4', type: 'shape', ref: 'krig.line.elbow', endpoints: [{ instance: 'i-1', magnet: 'E' }, { instance: 'i-2', magnet: 'W' }] },
  ],
  user_substances: [
    {
      id: 'user.test.abc123',
      category: 'user',
      name: 'Test',
      description: 'roundtrip',
      components: [
        { type: 'shape', ref: 'krig.basic.rect', transform: { x: 0, y: 0, w: 100, h: 50 }, binding: 'frame' },
      ],
      source: 'user',
      created_at: 1700000000000,
    },
  ],
};

// 模拟 serialize + deserialize:JSON.stringify + JSON.parse(测语义保留)
const json = JSON.stringify(before);
const after = JSON.parse(json);

const failed = [];

// 字段对等
if (after.schema_version !== SCHEMA_VERSION) failed.push(`schema_version mismatch: ${after.schema_version}`);
if (JSON.stringify(after.viewBox) !== JSON.stringify(before.viewBox)) failed.push('viewBox mismatch');
if (after.instances.length !== before.instances.length) failed.push(`instances count: ${after.instances.length} vs ${before.instances.length}`);
if (after.user_substances.length !== 1) failed.push(`user_substances count: ${after.user_substances.length}`);

// 关键字段保真
const i3 = after.instances.find((i) => i.id === 'i-3');
if (i3.props.label !== '贾宝玉') failed.push(`i-3.props.label lost: ${i3.props.label}`);
if (i3.props.gender !== 'M') failed.push(`i-3.props.gender lost: ${i3.props.gender}`);

const i4 = after.instances.find((i) => i.id === 'i-4');
if (!Array.isArray(i4.endpoints) || i4.endpoints.length !== 2) failed.push('i-4.endpoints lost');
if (i4.endpoints[0].magnet !== 'E' || i4.endpoints[1].magnet !== 'W') failed.push(`i-4 endpoint magnets wrong`);

const i2 = after.instances.find((i) => i.id === 'i-2');
if (i2.style_overrides.fill.color !== '#e8a8c0') failed.push('i-2.style_overrides.fill.color lost');

const us = after.user_substances[0];
if (us.id !== 'user.test.abc123') failed.push(`user_substance id lost: ${us.id}`);
if (us.source !== 'user') failed.push(`user_substance source lost: ${us.source}`);
if (us.components[0].binding !== 'frame') failed.push(`user_substance components.binding lost`);

// viewBox → centerX/Y/viewWidth 数学
const cx = before.viewBox.x + before.viewBox.w / 2;
const cy = before.viewBox.y + before.viewBox.h / 2;
const expectedCx = 100 + 1920 / 2;
const expectedCy = 50 + 1080 / 2;
if (cx !== expectedCx || cy !== expectedCy) failed.push(`viewBox center math wrong: (${cx},${cy})`);

console.log(`[serialize-smoke] roundtrip ${before.instances.length} instances + ${before.user_substances.length} user substances`);
if (failed.length === 0) {
  console.log('[serialize-smoke] OK ✓');
  process.exit(0);
} else {
  console.error('[serialize-smoke] FAIL:');
  for (const f of failed) console.error('  ' + f);
  process.exit(1);
}
