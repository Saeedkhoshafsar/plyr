// utils/dom-index-parser.js – نسخه ۳۶.۰ (Precision Edition)
// تفکیک کامل منطق indices و range برای دقت ۱۰۰٪

/**
 * تبدیل ورودی‌های نسبی (self, parent, +1, -1) به آبجکت استاندارد
 */
function parseRelative(input, childCount, siblingCount, currentSiblingIndex, parentChainLength) {
  // ۱. پشتیبانی از all (همه فرزندان)
  if (input === 'all' || input === '*') {
    return Array.from({ length: childCount }, (_, i) => ({ type: 'child', index: i }));
  }

  // ۲. پشتیبانی از self و self±N
  if (input === 'self' || input === 0) return { type: 'self' };
  
  if (typeof input === 'string' && input.startsWith('self')) {
    const offsetStr = input.replace('self', '');
    const offset = offsetStr === '' ? 0 : parseInt(offsetStr, 10);
    if (isNaN(offset)) return null;
    
    const target = currentSiblingIndex + offset;
    return (target >= 0 && target < siblingCount) ? { type: 'sibling', index: target } : null;
  }

  // ۳. پشتیبانی از parent و parent±N
  if (input === 'parent' || input === '..') return { type: 'parent', level: 1 };
  
  if (typeof input === 'string' && input.startsWith('parent')) {
    const offsetStr = input.replace('parent', '');
    const level = offsetStr === '' ? 1 : parseInt(offsetStr, 10);
    // لول باید مثبت باشد و از عمق DOM بیشتر نشود
    return (level > 0 && level <= parentChainLength) ? { type: 'parent', level } : null;
  }

  // ۴. پشتیبانی از اعداد (فرزندان)
  const num = parseInt(input, 10);
  if (isNaN(num)) return null;

  if (num === 0) return { type: 'self' };

  // اندیس مثبت (1-based) یا منفی
  const idx = num > 0 ? num - 1 : childCount + num;
  return (idx >= 0 && idx < childCount) ? { type: 'child', index: idx } : null;
}

/**
 * تابع اختصاصی برای پردازش لیست‌های گسسته (indices)
 * مثال: [1, 5, "self"] -> انتخاب آیتم اول، پنجم و خود المان
 */
function parseSelectionToIndices(input, childCount, siblingCount, currentSiblingIndex, parentChainLength, log) {
  const result = [];
  const seen = new Set();
  const items = Array.isArray(input) ? input : [input];

  for (let item of items) {
    // حل کردن آرایه در آرایه احتمالی
    if (Array.isArray(item)) {
       // بازگشتی برای ساختارهای پیچیده
       const subResults = parseSelectionToIndices(item, childCount, siblingCount, currentSiblingIndex, parentChainLength, log);
       subResults.forEach(r => result.push(r));
       continue;
    }

    const parsed = parseRelative(item, childCount, siblingCount, currentSiblingIndex, parentChainLength);
    if (!parsed) {
      if (log) log(`[parser] ورودی نامعتبر در indices: "${item}"`);
      continue;
    }

    // اگر all بود و آرایه برگرداند
    if (Array.isArray(parsed)) {
      for (const p of parsed) {
        const key = `child:${p.index}`;
        if (!seen.has(key)) { seen.add(key); result.push(p); }
      }
    } else {
      const key = `${parsed.type}:${parsed.index ?? parsed.level ?? 'self'}`;
      if (!seen.has(key)) { seen.add(key); result.push(parsed); }
    }
  }
  return result;
}

/**
 * تابع اختصاصی برای پردازش بازه‌ها (range)
 * مثال: [1, 5] -> انتخاب آیتم‌های ۱ تا ۵ (۱، ۲، ۳، ۴، ۵)
 */
function parseRangeToIndices(range, childCount, siblingCount, currentSiblingIndex, parentChainLength, log) {
  if (!Array.isArray(range) || range.length === 0) return [];

  const [startInput, endInput] = range;
  const result = [];

  // مورد خاص: [1, -1] یعنی همه فرزندان
  if (String(startInput) === '1' && String(endInput) === '-1') {
    for (let i = 0; i < childCount; i++) result.push({ type: 'child', index: i });
    return result;
  }

  const start = parseRelative(startInput, childCount, siblingCount, currentSiblingIndex, parentChainLength);
  const end = parseRelative(endInput ?? startInput, childCount, siblingCount, currentSiblingIndex, parentChainLength);

  if (!start || !end || Array.isArray(start) || Array.isArray(end)) {
     if (log) log(`[parser] بازه نامعتبر: ${JSON.stringify(range)}`);
     return [];
  }

  // اگر هر دو child باشند (رنج روی فرزندان)
  if (start.type === 'child' && end.type === 'child') {
    const min = Math.min(start.index, end.index);
    const max = Math.max(start.index, end.index);
    for (let i = min; i <= max; i++) result.push({ type: 'child', index: i });
  } 
  // اگر هر دو sibling باشند (رنج روی هم‌سطح‌ها)
  else if (start.type === 'sibling' && end.type === 'sibling') {
    const min = Math.min(start.index, end.index);
    const max = Math.max(start.index, end.index);
    for (let i = min; i <= max; i++) result.push({ type: 'sibling', index: i });
  } 
  // انواع مختلف (مثلاً از child تا parent) پشتیبانی نمی‌شود، پس جدا برمی‌گردانیم
  else {
    result.push(start);
    if (JSON.stringify(start) !== JSON.stringify(end)) result.push(end);
  }

  return result;
}

module.exports = {
  parseSelectionToIndices,
  parseRangeToIndices,
  parseRelative
};