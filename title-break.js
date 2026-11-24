(function (global) {
  "use strict";

  var PUNCT = new Set(Array.from("，。、；：！？,.;:!?—…"));
  var OPEN = new Set(Array.from("《「『“‘（(【["));
  var CLOSE = new Set(Array.from("》」』”’）)】]"));
  var BREAK_BEFORE_WORDS = [
    "为什么", "那么多", "这也是", "这是", "其实", "不过", "但是", "然而", "因为", "所以",
    "如果", "同时", "以及", "还有", "而是", "不是", "就是", "终于", "已经", "正在",
    "可以", "能够", "需要", "没有", "我们", "你们", "他们", "最后", "其中", "对于",
    "关于", "通过", "随着", "为了", "除了", "包括", "比如", "例如", "自己", "背后",
    "之后", "之前", "以后", "以前", "现在", "目前", "如今", "去年", "今年", "明年"
  ];
  var BREAK_BEFORE_CHARS = new Set(Array.from("而但却也还就又才都更最将把被让使给向从对为在与或及能会要可已正刚曾常总仍尚竟倒均皆等不没别先再只仅很太挺"));
  var AFTER_CHARS = new Set(Array.from("了着过地得吗呢吧啊呀啦嘛"));
  var NO_START = new Set(Array.from("的了着过地得吗呢吧啊呀啦嘛么而且及与和或等以于之"));
  var NO_END = new Set(Array.from("在把被将向给用让使对为从与和及或之第"));
  var BLOCK_WORDS = [
    "正在", "已经", "终于", "还是", "就是", "也是", "不是", "但是", "因为", "所以",
    "如果", "可以", "能够", "需要", "没有", "我们", "你们", "他们", "自己", "一个",
    "这个", "那个", "这些", "那些", "什么", "怎么", "为什么", "如何", "以及", "还有",
    "同时", "通过", "对于", "关于", "随着", "为了", "除了", "包括", "比如", "例如",
    "曾经", "目前", "现在", "如今", "之后", "之前", "以后", "以前", "背后", "周末",
    "高净值", "人工智能", "说明书",
    "走向", "飞向", "迈向", "通往", "指向", "面向", "导向", "驶向", "奔向",
    "即将", "开放共享", "独立自主", "圆满成功", "顺利升空", "航天", "空间", "载人", "飞船", "火箭", "升空"
  ];
  var ASCII = /[A-Za-z0-9０-９.%+＋#_\-]/;
  var DIGIT = /[0-9０-９]/;
  var CN_NUM = new Set(Array.from("零〇一二三四五六七八九十百千万两廿"));
  var UNIT = new Set(Array.from("年月日个台次倍万亿%元块岁点分秒时天周号位名届期项条家所种类级米里层艘架颗座套张份批轮场"));
  var SUFFIX = new Set(Array.from("员站者性化度率力感业界区场馆院校厂局部科室队团会路街桥楼层岛河湖海"));

  function textUnits(text) {
    var units = 0;
    Array.from(String(text || "")).forEach(function (ch) {
      var code = ch.codePointAt(0) || 0;
      if (code >= 0x2e80) units += 1;
      else if (/[A-Za-z0-9]/.test(ch)) units += 0.56;
      else if (ch === " ") units += 0.32;
      else units += 0.5;
    });
    return units || 1;
  }

  function isAscii(ch) {
    return ASCII.test(ch);
  }

  function segmentStarts(chars) {
    var starts = new Set();
    if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return starts;
    try {
      var seg = new Intl.Segmenter("zh-CN", { granularity: "word" });
      var index = 0;
      var first = true;
      for (var part of seg.segment(chars.join(""))) {
        if (!first) starts.add(index);
        first = false;
        index += Array.from(part.segment).length;
      }
    } catch (err) {
      return starts;
    }
    return starts;
  }

  function splitTitleIndex(text) {
    var chars = Array.from(String(text || "").trim());
    var n = chars.length;
    if (n <= 4) return -1;

    var blocked = new Set();
    var stack = [];
    for (var i = 0; i < n; i += 1) {
      var ch = chars[i];
      if (OPEN.has(ch)) {
        stack.push(i);
        continue;
      }
      if (CLOSE.has(ch)) {
        var open = stack.pop();
        if (open !== undefined) {
          for (var k = open + 1; k <= i; k += 1) blocked.add(k);
        }
        continue;
      }
      if (isAscii(ch)) {
        var j = i;
        while (j < n && isAscii(chars[j])) j += 1;
        for (var m = i + 1; m < j; m += 1) blocked.add(m);
        i = j - 1;
      }
    }

    for (var b = 1; b < n; b += 1) {
      if (DIGIT.test(chars[b - 1]) && UNIT.has(chars[b])) blocked.add(b);
      if (CN_NUM.has(chars[b - 1]) && (CN_NUM.has(chars[b]) || UNIT.has(chars[b]))) blocked.add(b);
      if (SUFFIX.has(chars[b]) && /[\u2e80-\u9fff]/.test(chars[b - 1])) blocked.add(b);
      if (chars[b - 1] === "第" && DIGIT.test(chars[b])) blocked.add(b);
    }

    var joined = chars.join("");
    BLOCK_WORDS.forEach(function (word) {
      var from = 0;
      while (true) {
        var at = joined.indexOf(word, from);
        if (at < 0) return;
        var start = Array.from(joined.slice(0, at)).length;
        var len = Array.from(word).length;
        for (var p = start + 1; p < start + len; p += 1) blocked.add(p);
        from = at + word.length;
      }
    });

    var starts = segmentStarts(chars);
    var unitsBefore = [0];
    for (var u = 0; u < n; u += 1) unitsBefore.push(unitsBefore[u] + textUnits(chars[u]));
    var total = unitsBefore[n];

    var best = -1;
    var bestScore = Infinity;
    var bestDist = Infinity;

    for (var index = 1; index < n; index += 1) {
      if (blocked.has(index)) continue;
      var leftUnits = unitsBefore[index];
      var rightUnits = total - leftUnits;
      var score = Math.abs(leftUnits - rightUnits);
      var leftChars = index;
      var rightChars = n - index;
      if (leftChars < 3) score += 24;
      if (rightChars < 3) score += 24;
      if (NO_START.has(chars[index])) score += 22;
      if (NO_END.has(chars[index - 1])) score += 18;
      if (PUNCT.has(chars[index])) score += 40;
      if (OPEN.has(chars[index - 1])) score += 40;

      var before = chars.slice(Math.max(0, index - 4), index).join("");
      var wordBreak = BREAK_BEFORE_WORDS.some(function (word) {
        return before.endsWith(word);
      });

      if (PUNCT.has(chars[index - 1])) score -= 10;
      else if (chars[index - 1] === " " || chars[index - 1] === "·" || chars[index - 1] === "—") score -= 8;
      else if (wordBreak) score -= 5;
      else if (BREAK_BEFORE_CHARS.has(chars[index])) score -= 3;
      else if (starts.has(index) && AFTER_CHARS.has(chars[index - 1])) score -= 3;
      else if (starts.has(index) && DIGIT.test(chars[index - 1]) && UNIT.has(chars[index])) score -= 3;
      else if (/[0-9A-Za-z０-９]/.test(chars[index - 1]) !== /[0-9A-Za-z０-９]/.test(chars[index])) score -= 2;
      else if (!starts.has(index)) score += 30;

      var dist = Math.abs(index - n / 2);
      if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) < 1e-9 && dist < bestDist)) {
        bestScore = score;
        best = index;
        bestDist = dist;
      }
    }

    if (best < 0) best = Math.ceil(n / 2);
    return best;
  }

  function splitTitleLines(text) {
    var chars = Array.from(String(text || "").trim());
    if (!chars.length) return [];
    var index = splitTitleIndex(chars.join(""));
    if (index < 0) return [chars.join("")];
    return [chars.slice(0, index).join(""), chars.slice(index).join("")].filter(Boolean);
  }

  global.OdTitleBreak = {
    textUnits: textUnits,
    splitTitleIndex: splitTitleIndex,
    splitTitleLines: splitTitleLines
  };
})(typeof window !== "undefined" ? window : globalThis);
