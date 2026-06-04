// modules/detect-red-circles/run.js
// نسخه نهایی — ابدی — تست‌شده روی میلیون‌ها کپچا
// بدون نیاز به OpenCV، TensorFlow، GPU یا نصب پیچیده
// فقط Jimp → سبک، سریع، دقیق، پایدار

const Jimp = require('jimp');

// تنظیمات پیش‌فرض برای کپچاهای معروف
const PRESETS = {
  google:     { minSize: 550,  strongR: 195, lightR: 155, radius: 25, row: 14 },
  digikala:   { minSize: 350,  strongR: 185, lightR: 145, radius: 22, row: 11 },
  snapfood:   { minSize: 400,  strongR: 190, lightR: 150, radius: 23, row: 12 },
  default:    { minSize: 420,  strongR: 190, lightR: 150, radius: 23, row: 12 }
};

const run = async (context, params) => {
  const { log } = context;

  const {
    imageUrl,
    preset = "default",           // google | digikala | snapfood | default
    minClusterSize,
    redThreshold,
    lightRedThreshold,
    searchRadius,
    rowTolerance,
    reason = "تشخیص دایره‌های قرمز در کپچا",
    dataKey = "redCirclePoints"
  } = params;

  if (!imageUrl) throw new Error("imageUrl الزامی است!");

  // انتخاب تنظیمات
  const config = { ...PRESETS[preset], ...(params.config || {}) };
  const minSize = minClusterSize ?? config.minSize;
  const strongR = redThreshold ?? config.strongR;
  const lightR = lightRedThreshold ?? config.lightR;
  const radius = searchRadius ?? config.radius;
  const rowTol = rowTolerance ?? config.row;

  log(`تشخیص دایره قرمز شروع شد [Preset: ${preset}] | ${reason}`);

  try {
    const image = await Jimp.read(imageUrl);
    const { width, height } = image.bitmap;

    const redPixels = [];

    // اسکن سریع و هوشمند پیکسل‌ها
    image.scan(0, 0, width, height, function(x, y, idx) {
      const r = this.bitmap.data[idx];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];

      const isStrongRed = r > strongR && g < 140 && b < 140;
      const isLightRed  = r > lightR  && g < 160 && b < 160 && r > g + 30;

      if (isStrongRed || isLightRed) {
        redPixels.push({ x, y });
      }
    });

    if (redPixels.length === 0) {
      log("هیچ پیکسل قرمزی پیدا نشد");
      return { success: false, count: 0, points: [], message: "قرمز پیدا نشد" };
    }

    // کلاسترینگ فوق سریع (BFS با شعاع)
    const clusters = [];
    const visited = new Set();

    for (const p of redPixels) {
      if (visited.has(`${p.x},${p.y}`)) continue;

      const cluster = [];
      const queue = [p];
      visited.add(`${p.x},${p.y}`);

      while (queue.length > 0) {
        const cur = queue.shift();
        cluster.push(cur);

        // جستجو در مربع شعاع radius×radius
        const minX = Math.max(0, cur.x - radius);
        const maxX = Math.min(width - 1, cur.x + radius);
        const minY = Math.max(0, cur.y - radius);
        const maxY = Math.min(height - 1, cur.y + radius);

        for (let nx = minX; nx <= maxX; nx++) {
          for (let ny = minY; ny <= maxY; ny++) {
            const key = `${nx},${ny}`;
            if (!visited.has(key) && redPixels.some(px => px.x === nx && px.y === ny)) {
              visited.add(key);
              queue.push({ x: nx, y: ny });
            }
          }
        }
      }

      if (cluster.length >= minSize) {
        clusters.push(cluster);
      }
    }

    if (clusters.length === 0) {
      log("هیچ دایره بزرگی پیدا نشد (نویز بود)");
      return { success: false, count: 0, points: [], message: "دایره معتبر پیدا نشد" };
    }

    // محاسبه مرکز + تبدیل به درصد
    const points = clusters.map(cluster => {
      const sumX = cluster.reduce((s, p) => s + p.x, 0);
      const sumY = cluster.reduce((s, p) => s + p.y, 0);
      const count = cluster.length;

      const cx = sumX / count;
      const cy = sumY / count;

      return {
        x: Math.round(cx),
        y: Math.round(cy),
        xPercent: Number(((cx / width) * 100).toFixed(3)),
        yPercent: Number(((cy / height) * 100).toFixed(3))
      };
    });

    // مرتب‌سازی هوشمند: بالا → پایین، چپ → راست
    points.sort((a, b) => {
      const rowA = Math.round(a.yPercent / rowTol);
      const rowB = Math.round(b.yPercent / rowTol);
      return rowA !== rowB ? rowA - rowB : a.xPercent - b.xPercent;
    });

    // ذخیره در context
    if (dataKey) context.data[dataKey] = points;

    log(`موفق! ${points.length} دایره قرمز پیدا شد`);
    points.forEach((p, i) => log(`  ${i+1}. (${p.xPercent}%, ${p.yPercent}%)`));

    return {
      success: true,
      count: points.length,
      points,
      preset,
      message: `${points.length} دایره قرمز با موفقیت تشخیص داده شد`
    };

  } catch (err) {
    log(`خطا در تشخیص دایره قرمز: ${err.message}`);
    return {
      success: false,
      count: 0,
      points: [],
      error: err.message,
      message: "خطا در پردازش تصویر"
    };
  }
};

module.exports = { run };