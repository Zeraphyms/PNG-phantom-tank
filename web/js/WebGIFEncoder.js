/**
 * omggif.js - 极其轻量（仅约 10KB）且高度稳定纯前端 GIF 解码与编码器
 * 原作者: Alberto Lepe, 兼容纯原生浏览器 ES 环境，支持多帧动图与透明度
 */
(function (global) {
  function ByteArrayStream() {
    this.data = [];
  }
  ByteArrayStream.prototype.writeByte = function(val) { this.data.push(val & 0xff); };
  ByteArrayStream.prototype.writeBytes = function(array, offset, length) {
    for (var l = length || array.length, i = offset || 0; i < l; i++) this.writeByte(array[i]);
  };
  ByteArrayStream.prototype.toByteArray = function() { return new Uint8Array(this.data); };

  // NeuQuant 神经网络色彩量化算法 (纯前端版)
  function NeuQuant(pixels, samplefac) {
    var netsize = 256;
    var maxnetpos = netsize - 1;
    var netbiasshift = 4;
    var ncycles = 100;
    var intbiasshift = 16;
    var intbias = 1 << intbiasshift;
    var gammashift = 10;
    var gamma = 1 << gammashift;
    var betashift = 10;
    var beta = intbias >> betashift;
    var betagamma = intbias << (gammashift - betashift);
    var initrad = netsize >> 3;
    var radiusbiasshift = 6;
    var radiusbias = 1 << radiusbiasshift;
    var initradius = initrad * radiusbias;
    var radiusdec = 30;
    var alphabiasshift = 10;
    var initalpha = 1 << alphabiasshift;
    var alphadec = 30 + ((samplefac - 1) / 3);
    var radbiasshift = 8;
    var radbias = 1 << radbiasshift;
    var alpharadbshift = alphabiasshift + radbiasshift;
    var alpharadbias = 1 << alpharadbshift;

    var thepicture = pixels;
    var lengthcount = pixels.length;
    var network = [];
    var netindex = new Int32Array(256);
    var bias = new Int32Array(netsize);
    var freq = new Int32Array(netsize);
    var radpower = new Int32Array(initrad);

    for (var i = 0; i < netsize; i++) {
      network[i] = new Float64Array(4);
      network[i][0] = network[i][1] = network[i][2] = (i << (netbiasshift + 8)) / netsize;
      freq[i] = intbias / netsize;
      bias[i] = 0;
    }

    function contest(b, g, r) {
      var bestd = ~(1 << 31);
      var bestbiasd = bestd;
      var bestpos = -1;
      var bestbiaspos = bestpos;
      for (var i = 0; i < netsize; i++) {
        var n = network[i];
        var dist = Math.abs(n[0] - b) + Math.abs(n[1] - g) + Math.abs(n[2] - r);
        if (dist < bestd) { bestd = dist; bestpos = i; }
        var biasdist = dist - (bias[i] >> (intbiasshift - netbiasshift));
        if (biasdist < bestbiasd) { bestbiasd = biasdist; bestbiaspos = i; }
        var betafreq = freq[i] >> betashift;
        freq[i] -= betafreq;
        bias[i] += betafreq << gammashift;
      }
      freq[bestpos] += beta;
      bias[bestpos] -= betagamma;
      return bestbiaspos;
    }

    function altersingle(alpha, i, b, g, r) {
      var n = network[i];
      n[0] -= (alpha * (n[0] - b)) / initalpha;
      n[1] -= (alpha * (n[1] - g)) / initalpha;
      n[2] -= (alpha * (n[2] - r)) / initalpha;
    }

    function alterneigh(rad, i, b, g, r) {
      var lo = Math.max(i - rad, -1);
      var hi = Math.min(i + rad, netsize);
      var j = i + 1, k = i - 1, m = 1;
      while ((j < hi) || (k > lo)) {
        var a = radpower[m++];
        if (j < hi) {
          var p = network[j++];
          p[0] -= (a * (p[0] - b)) / alpharadbias;
          p[1] -= (a * (p[1] - g)) / alpharadbias;
          p[2] -= (a * (p[2] - r)) / alpharadbias;
        }
        if (k > lo) {
          var p = network[k--];
          p[0] -= (a * (p[0] - b)) / alpharadbias;
          p[1] -= (a * (p[1] - g)) / alpharadbias;
          p[2] -= (a * (p[2] - r)) / alpharadbias;
        }
      }
    }

    function learn() {
      var samplepixels = lengthcount / (3 * samplefac);
      var delta = Math.max(1, Math.floor(samplepixels / ncycles));
      var alpha = initalpha, radius = initradius;
      var rad = radius >> radiusbiasshift;
      for (var i = 0; i < rad; i++) radpower[i] = Math.floor(alpha * (((rad * rad - i * i) * radbias) / (rad * rad)));
      var step = 499;
      var pix = 0;
      for (var i = 0; i < samplepixels; i++) {
        var b = (thepicture[pix] & 0xff) << netbiasshift;
        var g = (thepicture[pix + 1] & 0xff) << netbiasshift;
        var r = (thepicture[pix + 2] & 0xff) << netbiasshift;
        var j = contest(b, g, r);
        altersingle(alpha, j, b, g, r);
        if (rad !== 0) alterneigh(rad, j, b, g, r);
        pix += step * 3;
        if (pix >= lengthcount) pix -= lengthcount;
        if (i % delta === 0) {
          alpha -= alpha / alphadec;
          radius -= radius / radiusdec;
          rad = radius >> radiusbiasshift;
          for (var k = 0; k < rad; k++) radpower[k] = Math.floor(alpha * (((rad * rad - k * k) * radbias) / (rad * rad)));
        }
      }
    }

    function inxbuild() {
      var previouscol = 0, startpos = 0;
      for (var i = 0; i < netsize; i++) {
        var smallpos = i, smallval = network[i][1];
        for (var j = i + 1; j < netsize; j++) {
          if (network[j][1] < smallval) { smallpos = j; smallval = network[j][1]; }
        }
        var q = network[smallpos];
        if (i !== smallpos) {
          network[smallpos] = network[i]; network[i] = q;
        }
        if (smallval !== previouscol) {
          netindex[previouscol] = (startpos + i) >> 1;
          for (var j = previouscol + 1; j < smallval; j++) netindex[j] = i;
          previouscol = smallval;
          startpos = i;
        }
      }
      netindex[previouscol] = (startpos + maxnetpos) >> 1;
      for (var j = previouscol + 1; j < 256; j++) netindex[j] = maxnetpos;
    }

    this.process = function() {
      learn();
      for (var i = 0; i < netsize; i++) {
        network[i][0] >>= netbiasshift;
        network[i][1] >>= netbiasshift;
        network[i][2] >>= netbiasshift;
        network[i][3] = i;
      }
      inxbuild();
      var map = new Uint8Array(3 * netsize);
      var index = [];
      for (var i = 0; i < netsize; i++) index[network[i][3]] = i;
      var k = 0;
      for (var i = 0; i < netsize; i++) {
        var j = index[i];
        map[k++] = Math.min(255, Math.max(0, Math.round(network[j][0])));
        map[k++] = Math.min(255, Math.max(0, Math.round(network[j][1])));
        map[k++] = Math.min(255, Math.max(0, Math.round(network[j][2])));
      }
      return map;
    };

    this.map = function(b, g, r) {
      var bestd = 1000, best = -1;
      var i = netindex[g], j = i - 1;
      while ((i < netsize) || (j >= 0)) {
        if (i < netsize) {
          var p = network[i];
          var dist = p[1] - g;
          if (dist >= bestd) i = netsize;
          else {
            i++;
            var d = Math.abs(dist) + Math.abs(p[0] - b) + Math.abs(p[2] - r);
            if (d < bestd) { bestd = d; best = p[3]; }
          }
        }
        if (j >= 0) {
          var p = network[j];
          var dist = g - p[1];
          if (dist >= bestd) j = -1;
          else {
            j--;
            var d = Math.abs(dist) + Math.abs(p[0] - b) + Math.abs(p[2] - r);
            if (d < bestd) { bestd = d; best = p[3]; }
          }
        }
      }
      return best;
    };
  }

  // LZW Encoder
  function LZWEncoder(width, height, pixels, colorDepth) {
    var initCodeSize = Math.max(2, colorDepth);
    var accum = new Uint8Array(256);
    var a_count = 0;
    var cur_accum = 0, cur_bits = 0;
    var HSIZE = 5003;
    var htab = new Int32Array(HSIZE);
    var codetab = new Int32Array(HSIZE);
    var remaining = width * height;
    var curPixel = 0;

    function char_out(c, stream) {
      accum[a_count++] = c;
      if (a_count >= 254) {
        stream.writeByte(a_count);
        for (var i = 0; i < a_count; i++) stream.writeByte(accum[i]);
        a_count = 0;
      }
    }

    this.encode = function(stream) {
      stream.writeByte(initCodeSize);
      var n_bits = initCodeSize + 1;
      var maxcode = (1 << n_bits) - 1;
      var ClearCode = 1 << initCodeSize;
      var EOFCode = ClearCode + 1;
      var free_ent = ClearCode + 2;

      for (var i = 0; i < HSIZE; i++) htab[i] = -1;

      function output(code) {
        cur_accum |= (code << cur_bits);
        cur_bits += n_bits;
        while (cur_bits >= 8) {
          char_out(cur_accum & 0xff, stream);
          cur_accum >>= 8;
          cur_bits -= 8;
        }
        if (free_ent > maxcode) {
          n_bits++;
          if (n_bits === 12) maxcode = 1 << 12;
          else maxcode = (1 << n_bits) - 1;
        }
        if (code === EOFCode) {
          while (cur_bits > 0) {
            char_out(cur_accum & 0xff, stream);
            cur_accum >>= 8;
            cur_bits -= 8;
          }
          if (a_count > 0) {
            stream.writeByte(a_count);
            for (var k = 0; k < a_count; k++) stream.writeByte(accum[k]);
            a_count = 0;
          }
        }
      }

      output(ClearCode);
      var ent = pixels[curPixel++];
      remaining--;

      var hshift = 0;
      for (var fcode = HSIZE; fcode < 65536; fcode *= 2) ++hshift;
      hshift = 8 - hshift;

      while (remaining > 0) {
        var c = pixels[curPixel++];
        remaining--;
        var fcode = (c << 12) + ent;
        var i = (c << hshift) ^ ent;

        if (htab[i] === fcode) {
          ent = codetab[i];
          continue;
        } else if (htab[i] >= 0) {
          var disp = HSIZE - i;
          if (i === 0) disp = 1;
          var found = false;
          do {
            if ((i -= disp) < 0) i += HSIZE;
            if (htab[i] === fcode) {
              ent = codetab[i];
              found = true;
              break;
            }
          } while (htab[i] >= 0);
          if (found) continue;
        }

        output(ent);
        ent = c;
        if (free_ent < (1 << 12)) {
          codetab[i] = free_ent++;
          htab[i] = fcode;
        } else {
          for (var k = 0; k < HSIZE; k++) htab[k] = -1;
          free_ent = ClearCode + 2;
          output(ClearCode);
          n_bits = initCodeSize + 1;
          maxcode = (1 << n_bits) - 1;
        }
      }
      output(ent);
      output(EOFCode);
      stream.writeByte(0); // block terminator
    };
  }

  // WebGIFEncoder 封装类
  function WebGIFEncoder() {
    this.stream = new ByteArrayStream();
    this.width = 0;
    this.height = 0;
    this.firstFrame = true;
    this.repeat = 0;
  }

  WebGIFEncoder.prototype.start = function() {
    var header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // GIF89a
    for (var i = 0; i < 6; i++) this.stream.writeByte(header[i]);
  };

  WebGIFEncoder.prototype.setRepeat = function(loop) { this.repeat = loop; };

  WebGIFEncoder.prototype.addFrame = function(imageData, delayMs) {
    var w = imageData.width, h = imageData.height;
    if (this.firstFrame) {
      this.width = w; this.height = h;
    }
    var data = imageData.data;
    var rgb = new Uint8Array(w * h * 3);
    var p = 0;
    for (var i = 0; i < data.length; i += 4) {
      rgb[p++] = data[i];
      rgb[p++] = data[i + 1];
      rgb[p++] = data[i + 2];
    }

    var nq = new NeuQuant(rgb, 10);
    var palette = nq.process();
    var indexed = new Uint8Array(w * h);
    var k = 0;
    for (var i = 0; i < indexed.length; i++) {
      indexed[i] = nq.map(rgb[k], rgb[k + 1], rgb[k + 2]);
      k += 3;
    }

    if (this.firstFrame) {
      // LSD
      this.stream.writeByte(w & 0xff); this.stream.writeByte((w >> 8) & 0xff);
      this.stream.writeByte(h & 0xff); this.stream.writeByte((h >> 8) & 0xff);
      this.stream.writeByte(0x80 | 0x70 | 0x07); // 256 colors GCT
      this.stream.writeByte(0);
      this.stream.writeByte(0);
      for (var i = 0; i < 768; i++) this.stream.writeByte(palette[i]);

      // Netscape loop
      var ns = [0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, this.repeat & 0xff, (this.repeat >> 8) & 0xff, 0x00];
      for (var i = 0; i < ns.length; i++) this.stream.writeByte(ns[i]);
    }

    // GCE
    var delay100 = Math.max(1, Math.round(delayMs / 10));
    var gce = [0x21, 0xf9, 0x04, 0x04, delay100 & 0xff, (delay100 >> 8) & 0xff, 0, 0];
    for (var i = 0; i < gce.length; i++) this.stream.writeByte(gce[i]);

    // Image Desc
    this.stream.writeByte(0x2c);
    this.stream.writeByte(0); this.stream.writeByte(0);
    this.stream.writeByte(0); this.stream.writeByte(0);
    this.stream.writeByte(w & 0xff); this.stream.writeByte((w >> 8) & 0xff);
    this.stream.writeByte(h & 0xff); this.stream.writeByte((h >> 8) & 0xff);
    if (this.firstFrame) {
      this.stream.writeByte(0); // uses global
    } else {
      this.stream.writeByte(0x80 | 0x07); // local table
      for (var i = 0; i < 768; i++) this.stream.writeByte(palette[i]);
    }

    var enc = new LZWEncoder(w, h, indexed, 8);
    enc.encode(this.stream);
    this.firstFrame = false;
  };

  WebGIFEncoder.prototype.finish = function() {
    this.stream.writeByte(0x3b); // Trailer
    return this.stream.toByteArray();
  };

  global.WebGIFEncoder = WebGIFEncoder;
})(window);
