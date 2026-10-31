/**
 * GifReader.js - 纯前端 GIF87a/GIF89a 完整逐帧解码引擎
 * 完整支持 GIF Dispose 帧间累积叠加模式（Disposal Method 1: 不清空累积 / 2: 恢复背景 / 3: 恢复前一帧）
 */
(function(global) {
  function GifReader(u8Data) {
    var pos = 0;
    function readByte() { return u8Data[pos++]; }
    function readShort() { var b1 = u8Data[pos++], b2 = u8Data[pos++]; return b1 | (b2 << 8); }
    function readBytes(len) { var slice = u8Data.subarray(pos, pos + len); pos += len; return slice; }

    var sig = String.fromCharCode.apply(null, readBytes(6));
    if (!sig.startsWith("GIF")) throw new Error("不是合法的 GIF 动图");

    var width = readShort();
    var height = readShort();
    var packed = readByte();
    var gctFlag = (packed & 0x80) !== 0;
    var gctSize = 2 << (packed & 7);
    var bgIndex = readByte();
    var aspect = readByte();

    var gct = null;
    if (gctFlag) {
      gct = readBytes(gctSize * 3);
    }

    var frames = [];
    var loopCount = 0;
    var delay = 100;
    var transIndex = -1;
    var disposalMethod = 0;
    var lastDisposal = 0;

    // 累积全画幅画布
    var fullCanvas = document.createElement("canvas");
    fullCanvas.width = width;
    fullCanvas.height = height;
    var fullCtx = fullCanvas.getContext("2d", { willReadFrequently: true });
    var prevFrameCanvas = null;

    while (pos < u8Data.length) {
      var code = readByte();
      if (code === 0x3B) break; // Trailer

      if (code === 0x21) {
        var ext = readByte();
        if (ext === 0xF9) { // GCE
          var blockSize = readByte();
          var gcePacked = readByte();
          disposalMethod = (gcePacked >> 2) & 7;
          var transFlag = (gcePacked & 1) !== 0;
          var delayTime = readShort() * 10;
          delay = delayTime > 0 ? delayTime : 100;
          var tIdx = readByte();
          transIndex = transFlag ? tIdx : -1;
          readByte(); // 0 terminator
        } else if (ext === 0xFF) { // App ext
          var blockSize = readByte();
          var app = String.fromCharCode.apply(null, readBytes(blockSize));
          while (true) {
            var subLen = readByte();
            if (subLen === 0) break;
            if (app.startsWith("NETSCAPE2.0") && subLen === 3) {
              readByte(); // 1
              loopCount = readShort();
            } else {
              pos += subLen;
            }
          }
        } else {
          while (true) {
            var subLen = readByte();
            if (subLen === 0) break;
            pos += subLen;
          }
        }
      } else if (code === 0x2C) {
        // Image Descriptor
        var x = readShort(), y = readShort(), w = readShort(), h = readShort();
        var imgPacked = readByte();
        var lctFlag = (imgPacked & 0x80) !== 0;
        var lctSize = (2 << (imgPacked & 7));
        var interlace = (imgPacked & 0x40) !== 0;
        var act = gct;
        if (lctFlag) {
          act = readBytes(lctSize * 3);
        }

        var dataSize = readByte();
        var clear = 1 << dataSize;
        var endOfInfo = clear + 1;
        var available = clear + 2;
        var oldCode = -1;
        var codeSize = dataSize + 1;
        var codeMask = (1 << codeSize) - 1;

        var prefix = new Int32Array(4096);
        var suffix = new Uint8Array(4096);
        var pixelStack = new Uint8Array(4097);
        for (var c = 0; c < clear; c++) {
          prefix[c] = 0;
          suffix[c] = c;
        }

        var npix = w * h;
        var pixels = new Uint8Array(npix);
        var top = 0, bi = 0, count = 0, bits = 0, datum = 0;
        var block = null;
        var pi = 0, first = 0;

        function getBlock() {
          var blen = readByte();
          if (blen > 0) {
            var b = readBytes(blen);
            return { len: blen, buf: b };
          }
          return { len: 0, buf: null };
        }

        while (pi < npix) {
          if (top === 0) {
            if (bits < codeSize) {
              if (count === 0) {
                var res = getBlock();
                count = res.len;
                block = res.buf;
                bi = 0;
                if (count <= 0) break;
              }
              datum += (block[bi++] & 0xFF) << bits;
              bits += 8;
              count--;
              continue;
            }

            var codeVal = datum & codeMask;
            datum >>= codeSize;
            bits -= codeSize;

            if (codeVal > available || codeVal === endOfInfo) break;
            if (codeVal === clear) {
              codeSize = dataSize + 1;
              codeMask = (1 << codeSize) - 1;
              available = clear + 2;
              oldCode = -1;
              continue;
            }
            if (oldCode === -1) {
              pixelStack[top++] = suffix[codeVal];
              oldCode = codeVal;
              first = codeVal;
              continue;
            }

            var inCode = codeVal;
            if (codeVal === available) {
              pixelStack[top++] = first;
              codeVal = oldCode;
            }

            while (codeVal > clear) {
              pixelStack[top++] = suffix[codeVal];
              codeVal = prefix[codeVal];
            }

            first = suffix[codeVal] & 0xFF;
            if (available >= 4096) {
              pixelStack[top++] = first;
              oldCode = inCode;
              continue;
            }

            pixelStack[top++] = first;
            prefix[available] = oldCode;
            suffix[available] = first;
            available++;
            if ((available & codeMask) === 0 && available < 4096) {
              codeSize++;
              codeMask = (1 << codeSize) - 1;
            }
            oldCode = inCode;
          }

          top--;
          pixels[pi++] = pixelStack[top];
        }

        while (true) {
          var rem = readByte();
          if (rem === 0) break;
          pos += rem;
        }

        // 处理上一帧的 Disposal Method
        if (lastDisposal === 2) {
          // 恢复背景/清空
          fullCtx.clearRect(x, y, w, h);
        } else if (lastDisposal === 3 && prevFrameCanvas) {
          // 恢复到前一帧
          fullCtx.clearRect(0, 0, width, height);
          fullCtx.drawImage(prevFrameCanvas, 0, 0);
        }

        // 保存当前帧状态用于下一次 disposal 3
        if (disposalMethod === 3) {
          prevFrameCanvas = document.createElement("canvas");
          prevFrameCanvas.width = width;
          prevFrameCanvas.height = height;
          prevFrameCanvas.getContext("2d").drawImage(fullCanvas, 0, 0);
        }

        // 局部补丁图层离屏 Canvas
        var patchCanvas = document.createElement("canvas");
        patchCanvas.width = w;
        patchCanvas.height = h;
        var pctx = patchCanvas.getContext("2d");
        var patchData = pctx.createImageData(w, h);
        var pBuf = patchData.data;

        var pass = 1, inc = 8, iline = 0;
        for (var row = 0; row < h; row++) {
          var line = row;
          if (interlace) {
            if (iline >= h) {
              pass++;
              switch (pass) {
                case 2: iline = 4; break;
                case 3: iline = 2; inc = 4; break;
                case 4: iline = 1; inc = 2; break;
              }
            }
            line = iline;
            iline += inc;
          }
          var srcRowStart = row * w;
          var dstRowStart = line * w * 4;
          for (var col = 0; col < w; col++) {
            var pIdx = pixels[srcRowStart + col];
            if (pIdx !== transIndex && act) {
              var pOffset = dstRowStart + col * 4;
              var cOffset = pIdx * 3;
              pBuf[pOffset] = act[cOffset];
              pBuf[pOffset + 1] = act[cOffset + 1];
              pBuf[pOffset + 2] = act[cOffset + 2];
              pBuf[pOffset + 3] = 255;
            }
          }
        }
        pctx.putImageData(patchData, 0, 0);

        // 叠加绘制到累积画布上！
        fullCtx.drawImage(patchCanvas, x, y);

        // 输出当前完整合成画面
        var outCanvas = document.createElement("canvas");
        outCanvas.width = width;
        outCanvas.height = height;
        outCanvas.getContext("2d").drawImage(fullCanvas, 0, 0);

        frames.push({
          canvas: outCanvas,
          delay: delay,
          width: width,
          height: height
        });

        lastDisposal = disposalMethod;
      }
    }

    this.width = width;
    this.height = height;
    this.frames = frames;
    this.loopCount = loopCount;
  }

  global.GifReader = GifReader;
})(window);
