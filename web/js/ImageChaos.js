/**
 * ImageChaos.js - 图片混沌 (Image Chaos)
 *
 * 基于 Gilbert 空间填充曲线的可逆像素置换算法。
 * 把整幅图的像素按 Gilbert 曲线顺序重新排布到画布上，
 * 视觉上完全打散成噪声，但映射是可逆的，可无损还原。
 *
 * 混淆与解混淆使用同一张置换表：混淆是把源像素按曲线顺序写到目标位置，
 * 解混淆则按相反方向搬回去。支持多次叠加混淆。
 */
(function (global) {
  "use strict";

  // 浏览器内存与性能上限：超过则等比缩小后再处理
  var MAX_PIXELS = 8e6;
  var MAX_SIDE = 4e3;

  /**
   * 生成 w x h 画布上的 Gilbert 曲线坐标序列。
   * 直接移植自公开的 Gilbert 曲线实现，返回 [x, y] 数组。
   */
  function gilbertCurve(w, h) {
    var coords = [];
    if (w >= h) {
      walk(0, 0, w, 0, 0, h, coords);
    } else {
      walk(0, 0, 0, h, w, 0, coords);
    }
    return coords;
  }

  function walk(x, y, ax, ay, bx, by, out) {
    var w = Math.abs(ax + ay);
    var h = Math.abs(bx + by);
    var dax = Math.sign(ax), day = Math.sign(ay);
    var dbx = Math.sign(bx), dby = Math.sign(by);

    if (h === 1) {
      for (var i = 0; i < w; i++) { out.push([x, y]); x += dax; y += day; }
      return;
    }
    if (w === 1) {
      for (var j = 0; j < h; j++) { out.push([x, y]); x += dbx; y += dby; }
      return;
    }

    var ax2 = Math.floor(ax / 2), ay2 = Math.floor(ay / 2);
    var bx2 = Math.floor(bx / 2), by2 = Math.floor(by / 2);
    var w2 = Math.abs(ax2 + ay2);
    var h2 = Math.abs(bx2 + by2);

    if (2 * w > 3 * h) {
      if ((w2 % 2) && w > 2) { ax2 += dax; ay2 += day; }
      walk(x, y, ax2, ay2, bx, by, out);
      walk(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by, out);
    } else {
      if ((h2 % 2) && h > 2) { bx2 += dbx; by2 += dby; }
      walk(x, y, bx2, by2, ax2, ay2, out);
      walk(x + bx2, y + by2, ax, ay, bx - bx2, by - by2, out);
      walk(x + (ax - dax) + (bx2 - dbx), y + (ay - day) + (by2 - dby),
           -bx2, -by2, -(ax - ax2), -(ay - ay2), out);
    }
  }

  /**
   * 对 canvas 做一次混淆或解混淆，返回新的 canvas。
   * @param {HTMLCanvasElement} srcCanvas 源画布
   * @param {"enc"|"dec"} mode enc=混淆 dec=解混淆
   */
  function transform(srcCanvas, mode) {
    var w = srcCanvas.width;
    var h = srcCanvas.height;
    if (!w || !h) throw new Error("图片尺寸无效");

    var srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
    var srcData = srcCtx.getImageData(0, 0, w, h);
    var dstCanvas = document.createElement("canvas");
    dstCanvas.width = w;
    dstCanvas.height = h;
    var dstCtx = dstCanvas.getContext("2d", { willReadFrequently: true });
    var dstData = dstCtx.createImageData(w, h);

    var curve = gilbertCurve(w, h);
    var n = w * h;
    var src = srcData.data;
    var dst = dstData.data;

    // 用一个与曲线长度互质的偏移量错位，避免极坐标处出现规律条纹
    var offset = Math.round(((Math.sqrt(5) - 1) / 2) * n);

    for (var i = 0; i < n; i++) {
      var from = curve[i];
      var to = curve[(i + offset) % n];
      var srcIdx = 4 * (from[0] + from[1] * w);
      var dstIdx = 4 * (to[0] + to[1] * w);
      if (mode === "enc") {
        dst[dstIdx] = src[srcIdx];
        dst[dstIdx + 1] = src[srcIdx + 1];
        dst[dstIdx + 2] = src[srcIdx + 2];
        dst[dstIdx + 3] = src[srcIdx + 3];
      } else {
        dst[srcIdx] = src[dstIdx];
        dst[srcIdx + 1] = src[dstIdx + 1];
        dst[srcIdx + 2] = src[dstIdx + 2];
        dst[srcIdx + 3] = src[dstIdx + 3];
      }
    }

    dstCtx.putImageData(dstData, 0, 0);
    return dstCanvas;
  }

  /**
   * 把任意图片源转换为尺寸合规的 canvas（过大则等比缩小）。
   */
  function toCanvas(source, maxPixels, maxSide) {
    maxPixels = maxPixels || MAX_PIXELS;
    maxSide = maxSide || MAX_SIDE;

    var w = source.naturalWidth || source.width;
    var h = source.naturalHeight || source.height;
    if (!w || !h) throw new Error("图片尺寸无效");

    var pixels = w * h;
    var scale = Math.min(
      Math.sqrt(maxPixels / pixels),
      maxSide / w,
      maxSide / h,
      1
    );

    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));

    var canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, cw, ch);
    return canvas;
  }

  global.ImageChaos = {
    gilbertCurve: gilbertCurve,
    transform: transform,
    toCanvas: toCanvas,
    MAX_PIXELS: MAX_PIXELS,
    MAX_SIDE: MAX_SIDE
  };
})(window);
