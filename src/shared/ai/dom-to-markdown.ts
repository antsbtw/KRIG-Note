/**
 * DOM-to-Markdown converter script generator.
 *
 * Generates a self-contained JavaScript function that runs in the AI page's
 * browser context to convert rendered HTML back to Markdown text.
 *
 * Key capability: extracts LaTeX source from KaTeX/MathJax rendered math
 * elements using <annotation> tags, restoring $...$ and $$...$$ markers
 * that innerText would lose.
 */

/**
 * Returns a self-contained JS script string that defines `domToMarkdown(root)`.
 * The script can be concatenated into executeJavaScript calls.
 */
export function getDomToMarkdownScript(): string {
  // Use BT variable for backtick character to avoid template literal escaping issues
  // The generated script assigns var BT = String.fromCharCode(96) at the top
  return SCRIPT;
}

// Build the script as a plain string to avoid template literal backtick conflicts.
// Inside the script, we use a BT variable (= backtick char) for code fence markers.
const SCRIPT = [
  'var BT = String.fromCharCode(96);',
  'var BT3 = BT + BT + BT;',
  '',
  domToMarkdownFn(),
  processChildrenFn(),
  processNodeFn(),
  processInlineFn(),
  mathHelpersFn(),
  aiImagePlaceholderFn(),
  shouldSkipFn(),
  processTableFn(),
].join('\n');

function domToMarkdownFn(): string {
  return `
function domToMarkdown(root) {
  var lines = [];
  processChildren(root, lines, 0);
  var result = [];
  var prevBlank = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line === '') {
      if (!prevBlank) result.push('');
      prevBlank = true;
    } else {
      result.push(line);
      prevBlank = false;
    }
  }
  while (result.length > 0 && result[0] === '') result.shift();
  while (result.length > 0 && result[result.length - 1] === '') result.pop();

  // Post-process: if AI wrapped entire output in a code block, unwrap it
  if (result.length >= 3) {
    var first = result[0].trim();
    var last = result[result.length - 1].trim();
    var startsWithFence = first.indexOf(BT3) === 0;
    var endsWithFence = last === BT3;
    if (startsWithFence && endsWithFence) {
      var fenceLang = first.replace(BT3, '').trim().toLowerCase();
      if (fenceLang === '' || fenceLang === 'markdown' || fenceLang === 'md' || fenceLang === 'text') {
        result = result.slice(1, result.length - 1);
      }
    }
  }

  return result.join('\\n');
}`;
}

function processChildrenFn(): string {
  return `
function processChildren(parent, lines, depth) {
  var children = parent.childNodes;
  for (var i = 0; i < children.length; i++) {
    processNode(children[i], lines, depth);
  }
}`;
}

function processNodeFn(): string {
  return `
function processNode(node, lines, depth) {
  if (node.nodeType === 3) {
    var text = node.textContent;
    if (text && text.trim()) {
      var lastLine = lines.length > 0 ? lines[lines.length - 1] : null;
      if (lastLine !== null && lastLine !== '' && !lastLine.startsWith('#') && !lastLine.startsWith(BT3)) {
        lines[lines.length - 1] += text.replace(/\\n/g, ' ');
      } else {
        lines.push(text.replace(/\\n/g, ' ').trim());
      }
    }
    return;
  }
  if (node.nodeType !== 1) return;

  // Check for AI image placeholders BEFORE shouldSkip (which skips buttons)
  if (isAIImagePlaceholder(node)) {
    var placeholderAlt = getAIImageDescription(node);
    lines.push('');
    lines.push('![' + (placeholderAlt || 'Image') + '](image)');
    lines.push('');
    return;
  }

  if (shouldSkip(node)) return;

  var tag = node.tagName.toLowerCase();

  // Chart elements marked for screenshot: emit placeholder
  if (tag === 'svg' || tag === 'canvas') {
    var chartIdx = node.getAttribute ? node.getAttribute('data-mirro-chart-idx') : null;
    if (chartIdx !== null) {
      lines.push('');
      lines.push('%%CHART_' + chartIdx + '%%');
      lines.push('');
    }
    return;
  }

  if (isMathElement(node)) {
    // If this math element contains chart-marked children, don't treat as math —
    // recurse into children so SVG/canvas can emit %%CHART_N%% placeholders
    var hasChartChild = node.querySelector && node.querySelector('[data-mirro-chart-idx]');
    if (!hasChartChild) {
      var latex = extractLatexSource(node);
      if (latex) {
        if (isMathBlock(node)) {
          lines.push('');
          lines.push('$$');
          lines.push(latex);
          lines.push('$$');
          lines.push('');
        } else {
          var inlineStr = '$' + latex + '$';
          var last = lines.length > 0 ? lines[lines.length - 1] : null;
          if (last !== null && last !== '') {
            lines[lines.length - 1] += inlineStr;
          } else {
            lines.push(inlineStr);
          }
        }
        return;
      }
    }
  }

  if (/^h[1-6]$/.test(tag)) {
    var level = parseInt(tag.charAt(1));
    var prefix = '';
    for (var h = 0; h < level; h++) prefix += '#';
    prefix += ' ';
    lines.push('');
    lines.push(prefix + processInline(node));
    lines.push('');
    return;
  }

  if (tag === 'p') {
    var paraText = processInline(node);
    if (paraText.trim()) {
      lines.push('');
      lines.push(paraText);
    }
    return;
  }

  if (tag === 'ul' || tag === 'ol') {
    lines.push('');
    var items = [];
    var childNodes = node.children;
    for (var li = 0; li < childNodes.length; li++) {
      if (childNodes[li].tagName && childNodes[li].tagName.toLowerCase() === 'li') {
        items.push(childNodes[li]);
      }
    }
    for (var idx = 0; idx < items.length; idx++) {
      var itemPrefix = tag === 'ul' ? '- ' : ((idx + 1) + '. ');
      var itemText = processInline(items[idx]);
      lines.push(itemPrefix + itemText);
    }
    lines.push('');
    return;
  }

  if (tag === 'blockquote') {
    var quoteText = processInline(node);
    var quoteLines = quoteText.split('\\n');
    lines.push('');
    for (var q = 0; q < quoteLines.length; q++) {
      lines.push('> ' + quoteLines[q]);
    }
    lines.push('');
    return;
  }

  if (tag === 'pre') {
    var knownLangs = {python:1,javascript:1,typescript:1,java:1,c:1,cpp:1,csharp:1,go:1,rust:1,ruby:1,php:1,swift:1,kotlin:1,scala:1,r:1,sql:1,html:1,css:1,json:1,yaml:1,xml:1,bash:1,shell:1,sh:1,zsh:1,powershell:1,mermaid:1,markdown:1,md:1,lua:1,perl:1,dart:1,elixir:1,haskell:1,ocaml:1,zig:1,nim:1,toml:1,ini:1,dockerfile:1,makefile:1,cmake:1,graphql:1,protobuf:1,tex:1,latex:1,plaintext:1,text:1,txt:1};
    var lang = '';
    var codeText = '';

    // Path A: 传统结构 <pre><code class="language-xxx">
    var codeEl = node.querySelector('code');
    if (codeEl) {
      codeText = codeEl.textContent || '';
      var langClass = (codeEl.getAttribute('class') || '');
      var langMatch = langClass.match(/language-(\\w+)/);
      if (langMatch) lang = langMatch[1];
      if (!lang) lang = codeEl.getAttribute('data-language') || '';
    }

    // Path B: ChatGPT 新结构 — pre > div > div > [header div + code body div]
    // 没有 <code> 元素，用结构特征识别 header 和 code body
    if (!codeEl) {
      var allDivs = node.querySelectorAll('div');
      var headerDiv = null;
      // 找 header: 包含已知语言名或按钮的 div
      // 优先选择最小（textContent 最短）的匹配 — 避免选中外层 wrapper
      var headerCandidates = [];
      // 语言名排序列表（长名优先匹配，避免 "c" 匹配 "csharp" 的前缀）
      var knownLangsList = Object.keys(knownLangs).sort(function(a,b) { return b.length - a.length; });
      for (var hd = 0; hd < allDivs.length; hd++) {
        var hdEl = allDivs[hd];
        var hdText = (hdEl.innerText || hdEl.textContent || '').trim();
        if (!hdText || hdText.length > 100) continue;
        var hdLower = hdText.toLowerCase();
        var hasButton = hdEl.querySelector('button') !== null;
        var detectedLang = '';
        // 方法 1: 空格分割后精确匹配
        var hdWords = hdLower.split(/[\\s,\\n]+/);
        for (var hw = 0; hw < hdWords.length; hw++) {
          if (knownLangs[hdWords[hw]]) { detectedLang = hdWords[hw]; break; }
        }
        // 方法 2: 前缀匹配（ChatGPT 的 header 文字可能连在一起如 "PythonCopyRun"）
        if (!detectedLang) {
          for (var kl = 0; kl < knownLangsList.length; kl++) {
            var kLang = knownLangsList[kl];
            if (kLang.length < 2) continue; // 跳过单字母语言 "c", "r" 避免误匹配
            if (hdLower.indexOf(kLang) === 0) { detectedLang = kLang; break; }
          }
        }
        if (hasButton || detectedLang) {
          headerCandidates.push({ el: hdEl, len: hdText.length, lang: detectedLang });
        }
      }
      // 选包含按钮的最短 div 作为 header（最精确的匹配）
      if (headerCandidates.length > 0) {
        // 优先选有按钮的（真正的 header 包含 Copy/Run 按钮）
        var withBtn = [];
        for (var hc = 0; hc < headerCandidates.length; hc++) {
          if (headerCandidates[hc].el.querySelector('button')) withBtn.push(headerCandidates[hc]);
        }
        var best = withBtn.length > 0 ? withBtn[0] : headerCandidates[0];
        // 从有按钮的候选中选最短的
        var searchArr = withBtn.length > 0 ? withBtn : headerCandidates;
        for (var hb = 1; hb < searchArr.length; hb++) {
          if (searchArr[hb].len < best.len) best = searchArr[hb];
        }
        headerDiv = best.el;
        if (best.lang) lang = best.lang;
        // 如果 best 没有语言，从其他有语言的候选中获取
        if (!lang) {
          for (var lc = 0; lc < headerCandidates.length; lc++) {
            if (headerCandidates[lc].lang) { lang = headerCandidates[lc].lang; break; }
          }
        }
      }

      // code body = header 的 nextElementSibling
      var codeBody = null;
      if (headerDiv) {
        codeBody = headerDiv.nextElementSibling;
      }
      // Fallback: 如果 header 没有 nextSibling，往上找 — header 的父节点的 nextSibling
      if (!codeBody && headerDiv && headerDiv.parentElement) {
        codeBody = headerDiv.parentElement.nextElementSibling;
      }
      if (codeBody) {
        codeText = codeBody.innerText || codeBody.textContent || '';
      } else {
        // 最终 fallback: 在所有 div 中找文本最长且不含按钮的
        var bestDiv = null;
        var bestDivLen = 0;
        for (var bd = 0; bd < allDivs.length; bd++) {
          var bdEl = allDivs[bd];
          if (bdEl === headerDiv) continue;
          if (bdEl.querySelector('button')) continue;
          var bdLen = (bdEl.textContent || '').length;
          if (bdLen > bestDivLen) { bestDivLen = bdLen; bestDiv = bdEl; }
        }
        if (bestDiv) {
          codeText = bestDiv.innerText || bestDiv.textContent || '';
        } else {
          codeText = node.innerText || node.textContent || '';
        }
      }
    }

    // Fallback: 从 pre 自身/父容器/前兄弟节点检测语言
    if (!lang) lang = node.getAttribute('data-language') || '';
    if (!lang) {
      var prevSib = node.previousElementSibling;
      if (prevSib && prevSib.textContent) {
        var psText = prevSib.textContent.trim().toLowerCase().split(/[\\s,]+/)[0];
        if (knownLangs[psText]) lang = psText;
      }
    }

    // Mermaid 特殊处理: 渲染后源码可能被隐藏或替换
    var mermaidKeywords = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|journey|mindmap)/;
    if (lang === 'mermaid') {
      var trimmedCode = (codeText || '').trim();
      // 如果代码内容有效（包含 mermaid 关键字），直接使用
      if (trimmedCode.length >= 20 && mermaidKeywords.test(trimmedCode)) {
        // 有效的 mermaid 源码，正常输出
      } else if (!trimmedCode || trimmedCode.length < 20 || trimmedCode.indexOf('Loading') !== -1) {
        // 源码不可用（渲染后被替换），搜索隐藏节点
        var allNodes = node.querySelectorAll('*');
        for (var mn = 0; mn < allNodes.length; mn++) {
          var mText = (allNodes[mn].textContent || '').trim();
          if (mText.length > 20 && mermaidKeywords.test(mText)) {
            codeText = mText;
            break;
          }
        }
        // 如果仍无源码，跳过此代码块（避免输出 "Loading diagram..."）
        trimmedCode = (codeText || '').trim();
        if (!trimmedCode || trimmedCode.length < 20 || trimmedCode.indexOf('Loading') !== -1) {
          return;
        }
      }
    }
    // 非 mermaid 的代码块：如果内容看起来像 mermaid 但没有 lang，自动检测
    if (!lang && codeText) {
      var trimmedForDetect = codeText.trim();
      if (mermaidKeywords.test(trimmedForDetect)) {
        lang = 'mermaid';
      }
    }

    lines.push('');
    lines.push(BT3 + lang);
    var codeLines = (codeText || '').split('\\n');
    for (var cl = 0; cl < codeLines.length; cl++) {
      lines.push(codeLines[cl]);
    }
    lines.push(BT3);
    lines.push('');
    return;
  }

  if (tag === 'hr') {
    lines.push('');
    lines.push('---');
    lines.push('');
    return;
  }

  if (tag === 'img') {
    var imgSrc = node.getAttribute('src') || '';
    var imgAlt = node.getAttribute('alt') || '';
    if (imgSrc) {
      lines.push('');
      lines.push('![' + imgAlt + '](' + imgSrc + ')');
      lines.push('');
    }
    return;
  }

  if (tag === 'a') {
    var aHref = node.getAttribute('href') || '';
    var aText = processInline(node);
    if (aHref.indexOf('image:') === 0 || aHref.indexOf('image:page') !== -1) {
      lines.push('');
      lines.push('![' + aText + '](' + aHref + ')');
      lines.push('');
    } else if (aHref) {
      lines.push('[' + aText + '](' + aHref + ')');
    } else {
      lines.push(aText);
    }
    return;
  }

  if (tag === 'figure') {
    var figImg = node.querySelector('img');
    var figCaption = node.querySelector('figcaption');
    if (figImg) {
      var fSrc = figImg.getAttribute('src') || '';
      var fAlt = figImg.getAttribute('alt') || '';
      if (figCaption && figCaption.textContent) {
        fAlt = figCaption.textContent.trim();
      }
      if (fSrc) {
        lines.push('');
        lines.push('![' + fAlt + '](' + fSrc + ')');
        lines.push('');
      }
      return;
    }
    processChildren(node, lines, depth + 1);
    return;
  }

  if (tag === 'table') {
    processTable(node, lines);
    return;
  }

  if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'main' || tag === 'span') {
    var cls = node.className || '';
    if (typeof cls === 'string' && cls.indexOf('katex-display') !== -1) {
      var dLatex = extractLatexSource(node);
      if (dLatex) {
        lines.push('');
        lines.push('$$');
        lines.push(dLatex);
        lines.push('$$');
        lines.push('');
        return;
      }
    }
    processChildren(node, lines, depth + 1);
    return;
  }

  processChildren(node, lines, depth + 1);
}`;
}

function processInlineFn(): string {
  return `
function processInline(node) {
  var parts = [];
  var children = node.childNodes;
  for (var i = 0; i < children.length; i++) {
    var child = children[i];

    if (child.nodeType === 3) {
      parts.push(child.textContent || '');
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (shouldSkip(child)) continue;

    var ctag = child.tagName.toLowerCase();

    // Chart elements marked for screenshot: emit placeholder (even in inline context)
    if (ctag === 'svg' || ctag === 'canvas') {
      var cChartIdx = child.getAttribute ? child.getAttribute('data-mirro-chart-idx') : null;
      if (cChartIdx !== null) {
        parts.push('\\n%%CHART_' + cChartIdx + '%%\\n');
      }
      continue;
    }

    if (isMathElement(child)) {
      // If this math element contains chart-marked children, don't treat as math
      var hasChartInMath = child.querySelector && child.querySelector('[data-mirro-chart-idx]');
      if (!hasChartInMath) {
        var latex = extractLatexSource(child);
        if (latex) {
          if (isMathBlock(child)) {
            parts.push('\\n$$\\n' + latex + '\\n$$\\n');
          } else {
            parts.push('$' + latex + '$');
          }
          continue;
        }
      }
    }

    if (ctag === 'strong' || ctag === 'b') {
      parts.push('**' + processInline(child) + '**');
      continue;
    }
    if (ctag === 'em' || ctag === 'i') {
      parts.push('*' + processInline(child) + '*');
      continue;
    }
    if (ctag === 'code') {
      parts.push(BT + (child.textContent || '') + BT);
      continue;
    }
    if (ctag === 'a') {
      var href = child.getAttribute('href') || '';
      var linkText = processInline(child);
      // Check if this was originally an image placeholder: ![alt](image:...)
      if (href.indexOf('image:') === 0 || href.indexOf('image') === 0) {
        parts.push('![' + linkText + '](' + href + ')');
      } else {
        parts.push('[' + linkText + '](' + href + ')');
      }
      continue;
    }
    if (ctag === 'img') {
      var iSrc = child.getAttribute('src') || '';
      var iAlt = child.getAttribute('alt') || '';
      if (iSrc) {
        parts.push('![' + iAlt + '](' + iSrc + ')');
      }
      continue;
    }
    if (ctag === 'br') {
      parts.push('\\n');
      continue;
    }
    if (ctag === 'sub') {
      parts.push('_{' + processInline(child) + '}');
      continue;
    }
    if (ctag === 'sup') {
      parts.push('^{' + processInline(child) + '}');
      continue;
    }

    parts.push(processInline(child));
  }
  return parts.join('');
}`;
}

function mathHelpersFn(): string {
  return `
function isMathElement(node) {
  if (node.nodeType !== 1) return false;
  var cls = node.className || '';
  if (typeof cls !== 'string') cls = cls.toString ? cls.toString() : '';
  // KaTeX rendered elements
  if (cls.indexOf('katex') !== -1) return true;
  var tag = node.tagName.toLowerCase();
  // MathJax containers
  if (tag === 'mjx-container') return true;
  if (cls.indexOf('MathJax') !== -1) return true;
  // Native MathML
  if (tag === 'math') return true;
  // Gemini-specific: containers with math/formula/equation class
  var clsLower = cls.toLowerCase();
  if (clsLower.indexOf('math') !== -1 || clsLower.indexOf('formula') !== -1 || clsLower.indexOf('equation') !== -1) return true;
  // Container holding a <math> child (Gemini wraps MathML in spans/divs)
  if (node.querySelector && node.querySelector('math')) {
    // Only match if this node is small-ish (not the entire paragraph)
    if (node.childNodes.length <= 3) return true;
  }
  // data-formula attribute (some Gemini versions)
  if (node.getAttribute && (node.getAttribute('data-formula') || node.getAttribute('data-original-formula'))) return true;
  return false;
}

function isMathBlock(node) {
  var cls = node.className || '';
  if (typeof cls !== 'string') cls = cls.toString ? cls.toString() : '';
  if (cls.indexOf('katex-display') !== -1) return true;
  if (node.getAttribute && node.getAttribute('display') === 'true') return true;
  // MathML display attribute
  if (node.getAttribute && node.getAttribute('display') === 'block') return true;
  var parent = node.parentElement;
  if (parent) {
    var pcls = parent.className || '';
    if (typeof pcls !== 'string') pcls = pcls.toString ? pcls.toString() : '';
    if (pcls.indexOf('katex-display') !== -1) return true;
    if (parent.tagName.toLowerCase() === 'p' && parent.childNodes.length === 1) {
      return true;
    }
  }
  return false;
}

function extractLatexSource(node) {
  // Method 1: <annotation encoding="application/x-tex"> (standard KaTeX/MathJax)
  var annotation = node.querySelector('annotation[encoding="application/x-tex"]');
  if (annotation) return (annotation.textContent || '').trim();

  // Method 2: data-latex or data-formula attribute
  if (node.getAttribute) {
    var dataLatex = node.getAttribute('data-latex') || node.getAttribute('data-formula') || node.getAttribute('data-original-formula');
    if (dataLatex) return dataLatex.trim();
    var ariaLabel = node.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.indexOf('\\\\') !== -1) return ariaLabel.trim();
  }

  // Method 3: <script type="math/tex">
  var script = node.querySelector('script[type="math/tex"], script[type="math/tex; mode=display"]');
  if (script) return (script.textContent || '').trim();

  // Method 4: any annotation with tex encoding
  var annotations = node.querySelectorAll('annotation');
  for (var a = 0; a < annotations.length; a++) {
    var enc = annotations[a].getAttribute('encoding');
    if (enc && enc.indexOf('tex') !== -1) {
      return (annotations[a].textContent || '').trim();
    }
  }

  // Method 5: KaTeX without annotation (Gemini)
  // KaTeX renders .katex-mathml (screen-reader MathML) + .katex-html (visual).
  // When annotation is missing, extract from .katex-mathml textContent.
  var katexMathml = node.querySelector('.katex-mathml');
  if (katexMathml) {
    var mathmlText = (katexMathml.textContent || '').trim();
    if (mathmlText) return mathmlText;
  }

  // Method 6: <math> element textContent (Gemini MathML without annotation)
  var mathEl = (node.tagName && node.tagName.toLowerCase() === 'math') ? node : node.querySelector('math');
  if (mathEl) {
    // Try annotation first within the math element
    var mathAnnotation = mathEl.querySelector('annotation');
    if (mathAnnotation) return (mathAnnotation.textContent || '').trim();
    // Fall back to textContent of the math element
    var mathText = (mathEl.textContent || '').trim();
    if (mathText) return mathText;
  }

  // Method 7: aria-label on the node or parent (some renderers put LaTeX there)
  if (node.getAttribute) {
    var al = node.getAttribute('aria-label');
    if (al && al.trim().length > 0) return al.trim();
  }
  // Check parent for aria-label
  var parent = node.parentElement;
  if (parent && parent.getAttribute) {
    var pal = parent.getAttribute('aria-label');
    if (pal && pal.trim().length > 0) return pal.trim();
  }

  return null;
}`;
}

function aiImagePlaceholderFn(): string {
  return `
function isAIImagePlaceholder(node) {
  if (node.nodeType !== 1) return false;
  var tag = node.tagName.toLowerCase();

  // NEVER treat as placeholder if this node contains image:page references
  // (our PDF extraction placeholders must be preserved, not genericized)
  try {
    var nodeHtml = node.innerHTML || '';
    if (nodeHtml.indexOf('image:page') !== -1) return false;
    var nodeLinks = node.querySelectorAll ? node.querySelectorAll('a[href*="image:page"]') : [];
    if (nodeLinks.length > 0) return false;
    var nodeImgs = node.querySelectorAll ? node.querySelectorAll('img[src*="image:page"]') : [];
    if (nodeImgs.length > 0) return false;
  } catch(eCheck) {}

  // Claude: "Show Image" button or image artifact container
  // Claude renders images as a dark container with a "Show Image" or expand button
  if (tag === 'button') {
    var btnText = (node.textContent || '').trim().toLowerCase();
    if (btnText.indexOf('show image') !== -1 || btnText.indexOf('view image') !== -1 ||
        btnText.indexOf('expand image') !== -1) {
      return true;
    }
  }

  // Claude image artifact: div with data attributes for artifacts
  if (tag === 'div' || tag === 'section') {
    // Check for image-related aria labels or data attributes
    var ariaLabel = node.getAttribute('aria-label') || '';
    if (ariaLabel.toLowerCase().indexOf('image') !== -1) return true;

    // Check for "Show Image" button inside
    var btns = node.querySelectorAll('button');
    for (var b = 0; b < btns.length; b++) {
      var text = (btns[b].textContent || '').trim().toLowerCase();
      if ((text.indexOf('show image') !== -1 || text.indexOf('view image') !== -1) &&
          node.querySelectorAll('p').length === 0) {
        return true;
      }
    }

    // Claude image block: dark background container with an img inside that hasn't loaded
    // Only treat as placeholder if the img has NO src (hasn't loaded)
    var cls = node.className || '';
    if (typeof cls === 'string' && (cls.indexOf('image') !== -1 || cls.indexOf('artifact') !== -1)) {
      var innerImg = node.querySelector('img');
      if (innerImg && !innerImg.getAttribute('src')) return true;
      // If img has a real src, don't skip — let processNode handle it normally
    }
  }

  // ChatGPT: image in a wrapper div
  if (tag === 'div') {
    var cls2 = node.className || '';
    if (typeof cls2 === 'string' && cls2.indexOf('dall-e') !== -1) return true;
  }

  return false;
}

function getAIImageDescription(node) {
  // Try to find descriptive text near the image placeholder
  var text = '';

  // Check alt text on any img inside
  var img = node.querySelector('img');
  if (img) {
    text = img.getAttribute('alt') || img.getAttribute('title') || '';
    if (text) return text;
  }

  // Check aria-label
  var ariaLabel = node.getAttribute('aria-label') || '';
  if (ariaLabel && ariaLabel.toLowerCase() !== 'image') return ariaLabel;

  // Check preceding sibling for figure caption
  var prev = node.previousElementSibling;
  if (prev) {
    var prevText = (prev.textContent || '').trim();
    if (prevText.length < 100 && prevText.length > 0) {
      return prevText;
    }
  }

  // Check parent for caption context
  var next = node.nextElementSibling;
  if (next) {
    var nextText = (next.textContent || '').trim();
    if (nextText.length < 100 && nextText.length > 0 &&
        (nextText.indexOf('Figure') !== -1 || nextText.indexOf('Fig') !== -1 ||
         nextText.indexOf('\\u56fe') !== -1)) {
      return nextText;
    }
  }

  return '';
}`;
}

function shouldSkipFn(): string {
  return `
function shouldSkip(node) {
  if (node.nodeType !== 1) return false;
  var tag = node.tagName.toLowerCase();
  if (tag === 'button' || tag === 'input' || tag === 'select') return true;
  // SVG: skip unless marked as chart for screenshot
  if (tag === 'svg') {
    var chartAttr = node.getAttribute && node.getAttribute('data-mirro-chart-idx');
    if (chartAttr !== null && chartAttr !== undefined) return false;
    return true;
  }

  // Never skip elements containing our PDF image placeholders (image:page references)
  if (tag === 'img') {
    var imgSrc = node.getAttribute('src') || '';
    if (imgSrc.indexOf('image:page') !== -1 || imgSrc.indexOf('image') === 0) return false;
  }
  if (tag === 'a') {
    var aHrefCheck = node.getAttribute('href') || '';
    if (aHrefCheck.indexOf('image:page') !== -1) return false;
  }
  // Check for image:page links inside any container
  try {
    var imgPageLinks = node.querySelectorAll ? node.querySelectorAll('a[href*="image:page"], img[src*="image:page"]') : [];
    if (imgPageLinks.length > 0) return false;
  } catch(eSkip) {}

  try {
    var style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') {
      // Don't skip if this element contains our image placeholders
      var hiddenImgs = node.querySelectorAll ? node.querySelectorAll('img[src^="image"]') : [];
      if (hiddenImgs.length === 0) return true;
    }
    if (parseInt(style.height) === 0 && style.overflow === 'hidden') {
      var zeroImgs = node.querySelectorAll ? node.querySelectorAll('img[src^="image"]') : [];
      if (zeroImgs.length === 0) return true;
    }
  } catch (e) {}

  var cls = node.className || '';
  if (typeof cls !== 'string') cls = cls.toString ? cls.toString() : '';

  if (cls.indexOf('katex-html') !== -1) return true;
  if (cls.indexOf('MathJax_Display') !== -1 && node.querySelector('annotation')) return true;
  // Only skip copy-button divs, not containers that happen to have "copy" in class
  if ((cls.indexOf('copy-button') !== -1 || cls.indexOf('copy-code') !== -1) && tag === 'div') return true;
  if (cls.indexOf('toolbar') !== -1 && !node.querySelector('pre') && !node.querySelector('code')) return true;

  if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') {
    if (cls.indexOf('katex') === -1 && cls.indexOf('MathJax') === -1 && tag !== 'math') {
      // Don't skip if this element contains image:page links
      var hiddenLinks = node.querySelectorAll ? node.querySelectorAll('a[href*="image:page"]') : [];
      if (hiddenLinks.length > 0) return false;
      return true;
    }
  }
  return false;
}`;
}

function processTableFn(): string {
  return `
function processTable(table, lines) {
  var rows = table.querySelectorAll('tr');
  if (rows.length === 0) return;
  lines.push('');
  for (var r = 0; r < rows.length; r++) {
    var cells = rows[r].querySelectorAll('th, td');
    var rowParts = [];
    for (var c = 0; c < cells.length; c++) {
      rowParts.push(processInline(cells[c]).replace(/\\|/g, '\\\\|').replace(/\\n/g, ' '));
    }
    lines.push('| ' + rowParts.join(' | ') + ' |');
    if (r === 0) {
      var sep = [];
      for (var s = 0; s < rowParts.length; s++) sep.push('---');
      lines.push('| ' + sep.join(' | ') + ' |');
    }
  }
  lines.push('');
}`;
}
