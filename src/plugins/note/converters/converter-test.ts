/**
 * Converter Round-trip 测试
 *
 * 构造 ProseMirror Doc → docToAtoms() → atomsToDoc() → 对比。
 * 通过 DevTools console 调用 window.__testConverters(schema) 运行。
 *
 * 使用方式：
 *   1. 在 NoteView 初始化后，调用 registerConverterTest(schema)
 *   2. 打开 DevTools → Console → 输入 __testConverters()
 *   3. 查看输出：每个测试用例的 PASS/FAIL + Atom 详情
 */

import type { Schema, Node as PMNode } from 'prosemirror-model';
import { converterRegistry } from './registry';
import type { Atom } from '../../../shared/types/atom-types';

// ─── 测试工具 ───

interface TestResult {
  name: string;
  pass: boolean;
  atomCount: number;
  atoms: Atom[];
  roundTripMatch: boolean;
  details?: string;
}

function text(schema: Schema, str: string) { return schema.text(str); }

// ─── 测试用例 ───

function testNoteTitle(schema: Schema): TestResult {
  const doc = schema.node('doc', null, [
    schema.node('textBlock', { isTitle: true }, [text(schema, '测试标题')]),
  ]);
  return runRoundTrip('noteTitle', doc, (atoms) => {
    const title = atoms.find(a => a.type === 'noteTitle');
    return !!title && (title.content as any).children?.[0]?.text === '测试标题';
  });
}

function testParagraph(schema: Schema): TestResult {
  const doc = schema.node('doc', null, [
    schema.node('textBlock', null, [text(schema, '普通段落')]),
  ]);
  return runRoundTrip('paragraph', doc, (atoms) => {
    const p = atoms.find(a => a.type === 'paragraph');
    return !!p && (p.content as any).children?.[0]?.text === '普通段落';
  });
}

function testHeading(schema: Schema): TestResult {
  const doc = schema.node('doc', null, [
    schema.node('textBlock', { level: 1 }, [text(schema, 'H1 标题')]),
    schema.node('textBlock', { level: 2 }, [text(schema, 'H2 标题')]),
    schema.node('textBlock', { level: 3 }, [text(schema, 'H3 标题')]),
  ]);
  return runRoundTrip('heading (H1/H2/H3)', doc, (atoms) => {
    const headings = atoms.filter(a => a.type === 'heading');
    return headings.length === 3
      && (headings[0].content as any).level === 1
      && (headings[1].content as any).level === 2
      && (headings[2].content as any).level === 3;
  });
}

function testMarks(schema: Schema): TestResult {
  const doc = schema.node('doc', null, [
    schema.node('textBlock', null, [
      schema.text('加粗', [schema.marks.bold.create()]),
      text(schema, ' '),
      schema.text('斜体', [schema.marks.italic.create()]),
      text(schema, ' '),
      schema.text('代码', [schema.marks.code.create()]),
    ]),
  ]);
  return runRoundTrip('marks (bold/italic/code)', doc, (atoms) => {
    const p = atoms.find(a => a.type === 'paragraph');
    if (!p) return false;
    const children = (p.content as any).children;
    const hasBold = children.some((c: any) => c.marks?.some((m: any) => m.type === 'bold'));
    const hasItalic = children.some((c: any) => c.marks?.some((m: any) => m.type === 'italic'));
    const hasCode = children.some((c: any) => c.marks?.some((m: any) => m.type === 'code'));
    return hasBold && hasItalic && hasCode;
  });
}

function testLink(schema: Schema): TestResult {
  const doc = schema.node('doc', null, [
    schema.node('textBlock', null, [
      schema.text('点击链接', [schema.marks.link.create({ href: 'https://example.com' })]),
    ]),
  ]);
  return runRoundTrip('link', doc, (atoms) => {
    const p = atoms.find(a => a.type === 'paragraph');
    if (!p) return false;
    const link = (p.content as any).children.find((c: any) => c.type === 'link');
    return !!link && link.href === 'https://example.com';
  });
}

function testBulletList(schema: Schema): TestResult {
  // KRIG-Note: bulletList content: 'block+' — 直接包含 textBlock，无 listItem
  const doc = schema.node('doc', null, [
    schema.node('bulletList', null, [
      schema.node('textBlock', null, [text(schema, '项目 A')]),
      schema.node('textBlock', null, [text(schema, '项目 B')]),
      schema.node('textBlock', null, [text(schema, '项目 C')]),
    ]),
  ]);
  return runRoundTrip('bulletList (3 items)', doc, (atoms) => {
    const list = atoms.find(a => a.type === 'bulletList');
    const items = atoms.filter(a => a.type === 'paragraph' && a.parentId === list?.id);
    return !!list && items.length === 3;
  });
}

function testOrderedList(schema: Schema): TestResult {
  const doc = schema.node('doc', null, [
    schema.node('orderedList', null, [
      schema.node('textBlock', null, [text(schema, '第一步')]),
      schema.node('textBlock', null, [text(schema, '第二步')]),
    ]),
  ]);
  return runRoundTrip('orderedList (2 items)', doc, (atoms) => {
    const list = atoms.find(a => a.type === 'orderedList');
    const items = atoms.filter(a => a.type === 'paragraph' && a.parentId === list?.id);
    return !!list && items.length === 2;
  });
}

function testCodeBlock(schema: Schema): TestResult {
  const doc = schema.node('doc', null, [
    schema.node('codeBlock', { language: 'typescript' }, [text(schema, 'const x = 42;')]),
  ]);
  return runRoundTrip('codeBlock (typescript)', doc, (atoms) => {
    const code = atoms.find(a => a.type === 'codeBlock');
    return !!code
      && (code.content as any).code === 'const x = 42;'
      && (code.content as any).language === 'typescript';
  });
}

function testMathBlock(schema: Schema): TestResult {
  // mathBlock content: 'text*' — LaTeX 存在 text content 里
  const doc = schema.node('doc', null, [
    schema.node('mathBlock', null, [text(schema, 'E = mc^2')]),
  ]);
  return runRoundTrip('mathBlock (LaTeX)', doc, (atoms) => {
    const math = atoms.find(a => a.type === 'mathBlock');
    return !!math && (math.content as any).latex === 'E = mc^2';
  });
}

function testHorizontalRule(schema: Schema): TestResult {
  const doc = schema.node('doc', null, [
    schema.node('textBlock', null, [text(schema, '上方')]),
    schema.node('horizontalRule'),
    schema.node('textBlock', null, [text(schema, '下方')]),
  ]);
  return runRoundTrip('horizontalRule', doc, (atoms) => {
    return atoms.some(a => a.type === 'horizontalRule');
  });
}

function testBlockquote(schema: Schema): TestResult {
  const doc = schema.node('doc', null, [
    schema.node('blockquote', null, [
      schema.node('textBlock', null, [text(schema, '引用内容')]),
    ]),
  ]);
  return runRoundTrip('blockquote', doc, (atoms) => {
    const bq = atoms.find(a => a.type === 'blockquote');
    return !!bq;
  });
}

function testTable(schema: Schema): TestResult {
  const doc = schema.node('doc', null, [
    schema.node('table', null, [
      schema.node('tableRow', null, [
        schema.node('tableHeader', null, [schema.node('textBlock', null, [text(schema, '名称')])]),
        schema.node('tableHeader', null, [schema.node('textBlock', null, [text(schema, '值')])]),
      ]),
      schema.node('tableRow', null, [
        schema.node('tableCell', null, [schema.node('textBlock', null, [text(schema, 'x')])]),
        schema.node('tableCell', null, [schema.node('textBlock', null, [text(schema, '42')])]),
      ]),
    ]),
  ]);
  return runRoundTrip('table (2×2 with header)', doc, (atoms) => {
    const table = atoms.find(a => a.type === 'table');
    const rows = atoms.filter(a => a.type === 'tableRow');
    const headers = atoms.filter(a => a.type === 'tableHeader');
    const cells = atoms.filter(a => a.type === 'tableCell');
    return !!table && rows.length === 2 && headers.length === 2 && cells.length === 2;
  });
}

function testMixedDocument(schema: Schema): TestResult {
  const doc = schema.node('doc', null, [
    schema.node('textBlock', { isTitle: true }, [text(schema, '混合文档测试')]),
    schema.node('textBlock', { level: 1 }, [text(schema, '第一章')]),
    schema.node('textBlock', null, [text(schema, '这是正文段落。')]),
    schema.node('bulletList', null, [
      schema.node('textBlock', null, [text(schema, '要点一')]),
      schema.node('textBlock', null, [text(schema, '要点二')]),
    ]),
    schema.node('codeBlock', { language: 'python' }, [text(schema, 'print("hello")')]),
    schema.node('mathBlock', { latex: '\\sum_{i=1}^{n} x_i' }),
    schema.node('horizontalRule'),
    schema.node('textBlock', null, [text(schema, '结尾段落。')]),
  ]);
  return runRoundTrip('mixed document (8 top-level nodes)', doc, (atoms) => {
    const types = new Set(atoms.map(a => a.type));
    return types.has('noteTitle')
      && types.has('heading')
      && types.has('paragraph')
      && types.has('bulletList')
      && types.has('codeBlock')
      && types.has('mathBlock')
      && types.has('horizontalRule');
  });
}

// ─── Round-trip 核心 ───

function runRoundTrip(
  name: string,
  doc: PMNode,
  validate: (atoms: Atom[]) => boolean,
): TestResult {
  // Forward: PM Doc → Atom[]
  const atoms = converterRegistry.docToAtoms(doc);
  const contentValid = validate(atoms);

  // Reverse: Atom[] → PM Doc JSON
  const docJson = converterRegistry.atomsToDoc(atoms);
  const roundTripMatch = docJson.content?.length === doc.content.childCount;

  return {
    name,
    pass: contentValid,
    atomCount: atoms.length,
    atoms,
    roundTripMatch,
    details: contentValid ? undefined : 'Content validation failed',
  };
}

// ─── 注册到 window（供 DevTools console 调用）───

export function registerConverterTest(schema: Schema): void {

  (window as any).__testConverters = () => {
    const tests = [
      testNoteTitle(schema),
      testParagraph(schema),
      testHeading(schema),
      testMarks(schema),
      testLink(schema),
      testBulletList(schema),
      testOrderedList(schema),
      testCodeBlock(schema),
      testMathBlock(schema),
      testHorizontalRule(schema),
      testBlockquote(schema),
      testTable(schema),
      testMixedDocument(schema),
    ];

    console.group('🧪 Converter Round-trip Tests');
    let passed = 0;
    let failed = 0;

    for (const t of tests) {
      const icon = t.pass ? '✅' : '❌';
      const rt = t.roundTripMatch ? '↔️' : '⚠️';
      console.log(`${icon} ${t.name} — ${t.atomCount} atoms ${rt}`);
      if (!t.pass) {
        console.log('  Details:', t.details);
        console.log('  Atoms:', t.atoms);
        failed++;
      } else {
        passed++;
      }
    }

    console.log(`\n${passed}/${tests.length} passed, ${failed} failed`);
    console.groupEnd();

    return { passed, failed, total: tests.length, results: tests };
  };

  console.log('[ConverterTest] Registered. Run __testConverters() in console.');
}

