/**
 * GifReader.js - 纯前端 GIF87a/GIF89a 完整逐帧解码引擎
 * 提取动图的每一帧 ImageData、延时及循环次数，用于合成多帧动态 APNG
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
          // Other extension, skip blocks
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

        // skip trailing zero blocks
        while (true) {
          var rem = readByte();
          if (rem === 0) break;
          pos += rem;
        }

        // Convert indexed pixels to Canvas RGBA
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext("2d");
        var imgData = ctx.createImageData(width, height);
        var dataBuf = imgData.data;

        // Render pass considering interlace
        var pass = 1, inc = 8, iline = 0;
        for (var i = 0; i < h; i++) {
          var line = i;
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
          line += y;
          if (line < height) {
            var rowStart = line * width + x;
            var srcRowStart = i * w;
            for (var col = 0; col < w; col++) {
              if (x + col < width) {
                var pIdx = pixels[srcRowStart + col];
                if (pIdx !== transIndex && act) {
                  var pOffset = (rowStart + col) * 4;
                  var cOffset = pIdx * 3;
                  dataBuf[pOffset] = act[cOffset];
                  dataBuf[pOffset + 1] = act[cOffset + 1];
                  dataBuf[pOffset + 2] = act[cOffset + 2];
                  dataBuf[pOffset + 3] = 255;
                }
              }
            }
          }
        }
        ctx.putImageData(imgData, 0, 0);

        frames.push({
          canvas: canvas,
          delay: delay,
          width: width,
          height: height
        });
      }
    }

    this.width = width;
    this.height = height;
    this.frames = frames;
    this.loopCount = loopCount;
  }

  global.GifReader = GifReader;
})(window);
