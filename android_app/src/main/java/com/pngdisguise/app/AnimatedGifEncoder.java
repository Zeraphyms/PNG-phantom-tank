package com.pngdisguise.app;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;

public class AnimatedGifEncoder {

    protected int width;
    protected int height;
    protected int transparent = -1;
    protected int transIndex;
    protected int repeat = -1;
    protected int delay = 0;
    protected boolean started = false;
    protected ByteArrayOutputStream out;
    protected Bitmap image;
    protected byte[] pixels;
    protected byte[] indexedPixels;
    protected int colorDepth;
    protected byte[] colorTab;
    protected boolean[] usedEntry = new boolean[256];
    protected int palSize = 7;
    protected int dispose = -1;
    protected boolean closeStream = false;
    protected boolean firstFrame = true;
    protected boolean sizeSet = false;
    protected int sample = 10;

    public void setDelay(int ms) {
        delay = Math.round(ms / 10.0f);
        if (delay < 1) delay = 1;
    }

    public void setRepeat(int loopCount) {
        if (loopCount >= 0) {
            repeat = loopCount;
        }
    }

    public void setDispose(int code) {
        if (code >= 0) {
            dispose = code;
        }
    }

    public boolean start(ByteArrayOutputStream os) {
        if (os == null) return false;
        boolean ok = true;
        closeStream = false;
        out = os;
        try {
            writeString("GIF89a");
        } catch (IOException e) {
            ok = false;
        }
        return started = ok;
    }

    public boolean addFrame(Bitmap im, int delayMs) {
        if ((im == null) || !started) {
            return false;
        }
        boolean ok = true;
        try {
            if (!sizeSet) {
                setSize(im.getWidth(), im.getHeight());
            }
            image = im;
            setDelay(delayMs);
            getImagePixels();
            analyzePixels();
            if (firstFrame) {
                writeLSD();
                writePalette();
                if (repeat >= 0) {
                    writeNetscapeExt();
                }
            }
            writeGraphicCtrlExt();
            writeImageDesc();
            if (!firstFrame) {
                writePalette();
            }
            writePixels();
            firstFrame = false;
        } catch (IOException e) {
            ok = false;
        }
        return ok;
    }

    public boolean finish() {
        if (!started) return false;
        boolean ok = true;
        started = false;
        try {
            out.write(0x3b); // gif trailer
            out.flush();
        } catch (IOException e) {
            ok = false;
        }
        return ok;
    }

    public void setSize(int w, int h) {
        width = w;
        height = h;
        if (width < 1) width = 1;
        if (height < 1) height = 1;
        sizeSet = true;
    }

    protected void getImagePixels() {
        int w = image.getWidth();
        int h = image.getHeight();
        if ((w != width) || (h != height)) {
            Bitmap temp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(temp);
            c.drawBitmap(image, 0, 0, new Paint());
            image = temp;
        }
        int[] rgb = new int[width * height];
        image.getPixels(rgb, 0, width, 0, 0, width, height);
        pixels = new byte[rgb.length * 3];
        int count = 0;
        for (int i = 0; i < rgb.length; i++) {
            int val = rgb[i];
            pixels[count++] = (byte) ((val >> 16) & 0xFF); // r
            pixels[count++] = (byte) ((val >> 8) & 0xFF);  // g
            pixels[count++] = (byte) (val & 0xFF);         // b
        }
    }

    protected void analyzePixels() {
        int len = pixels.length;
        int nPix = len / 3;
        indexedPixels = new byte[nPix];
        NeuQuant nq = new NeuQuant(pixels, len, sample);
        colorTab = nq.process();
        int k = 0;
        for (int i = 0; i < nPix; i++) {
            int index = nq.map(pixels[k++] & 0xff, pixels[k++] & 0xff, pixels[k++] & 0xff);
            usedEntry[index] = true;
            indexedPixels[i] = (byte) index;
        }
        pixels = null;
        colorDepth = 8;
        palSize = 7;
    }

    protected void writeGraphicCtrlExt() throws IOException {
        out.write(0x21); // extension introducer
        out.write(0xf9); // GCE
        out.write(4);    // data size
        int packed;
        int transp;
        if (transparent == -1) {
            packed = 0;
            transp = 0;
        } else {
            packed = 1;
            transp = 1;
        }
        if (dispose >= 0) {
            packed |= (dispose & 7) << 2;
        }
        out.write(packed);
        writeShort(delay);
        out.write(transIndex);
        out.write(0);
    }

    protected void writeImageDesc() throws IOException {
        out.write(0x2c); // image separator
        writeShort(0);   // image left
        writeShort(0);   // image top
        writeShort(width);
        writeShort(height);
        if (firstFrame) {
            out.write(0); // no local color table on first frame
        } else {
            out.write(0x80 | 0x07); // local color table
        }
    }

    protected void writeLSD() throws IOException {
        writeShort(width);
        writeShort(height);
        out.write((0x80 | (7 << 4) | (0 << 3) | 7)); // global color table flag
        out.write(0); // background color index
        out.write(0); // pixel aspect ratio
    }

    protected void writeNetscapeExt() throws IOException {
        out.write(0x21);
        out.write(0xff);
        out.write(11);
        writeString("NETSCAPE2.0");
        out.write(3);
        out.write(1);
        writeShort(repeat);
        out.write(0);
    }

    protected void writePalette() throws IOException {
        out.write(colorTab, 0, colorTab.length);
        int n = (3 * 256) - colorTab.length;
        for (int i = 0; i < n; i++) {
            out.write(0);
        }
    }

    protected void writePixels() throws IOException {
        LzwEncoder encoder = new LzwEncoder(width, height, indexedPixels, colorDepth);
        encoder.encode(out);
    }

    protected void writeShort(int value) throws IOException {
        out.write(value & 0xff);
        out.write((value >> 8) & 0xff);
    }

    protected void writeString(String s) throws IOException {
        for (int i = 0; i < s.length(); i++) {
            out.write((byte) s.charAt(i));
        }
    }

    static class NeuQuant {
        protected static final int netsize = 256;
        protected static final int prime1 = 499;
        protected static final int prime2 = 491;
        protected static final int prime3 = 487;
        protected static final int prime4 = 503;
        protected static final int minpicturebytes = (3 * prime4);
        protected static final int maxnetpos = (netsize - 1);
        protected static final int netbiasshift = 4;
        protected static final int ncycles = 100;
        protected static final int intbiasshift = 16;
        protected static final int intbias = (((int) 1) << intbiasshift);
        protected static final int gammashift = 10;
        protected static final int gamma = (((int) 1) << gammashift);
        protected static final int betashift = 10;
        protected static final int beta = (intbias >> betashift);
        protected static final int betagamma = (intbias << (gammashift - betashift));
        protected static final int initrad = (netsize >> 3);
        protected static final int radiusbiasshift = 6;
        protected static final int radiusbias = (((int) 1) << radiusbiasshift);
        protected static final int initradius = (initrad * radiusbias);
        protected static final int radiusdec = 30;
        protected static final int alphabiasshift = 10;
        protected static final int initalpha = (((int) 1) << alphabiasshift);
        protected int alphadec;
        protected static final int radbiasshift = 8;
        protected static final int radbias = (((int) 1) << radbiasshift);
        protected static final int alpharadbshift = (alphabiasshift + radbiasshift);
        protected static final int alpharadbias = (((int) 1) << alpharadbshift);

        protected byte[] thepicture;
        protected int lengthcount;
        protected int samplefac;
        protected int[][] network;
        protected int[] netindex = new int[256];
        protected int[] bias = new int[netsize];
        protected int[] freq = new int[netsize];
        protected int[] radpower = new int[initrad];

        public NeuQuant(byte[] thepic, int len, int sample) {
            thepicture = thepic;
            lengthcount = len;
            samplefac = sample;
            network = new int[netsize][];
            for (int i = 0; i < netsize; i++) {
                network[i] = new int[4];
                int[] p = network[i];
                p[0] = p[1] = p[2] = (i << (netbiasshift + 8)) / netsize;
                freq[i] = intbias / netsize;
                bias[i] = 0;
            }
        }

        public byte[] colorMap() {
            byte[] map = new byte[3 * netsize];
            int[] index = new int[netsize];
            for (int i = 0; i < netsize; i++) index[network[i][3]] = i;
            int k = 0;
            for (int i = 0; i < netsize; i++) {
                int j = index[i];
                map[k++] = (byte) (network[j][0]);
                map[k++] = (byte) (network[j][1]);
                map[k++] = (byte) (network[j][2]);
            }
            return map;
        }

        public void inxbuild() {
            int previouscol = 0;
            int startpos = 0;
            for (int i = 0; i < netsize; i++) {
                int[] p = network[i];
                int smallpos = i;
                int smallval = p[1];
                for (int j = i + 1; j < netsize; j++) {
                    int[] q = network[j];
                    if (q[1] < smallval) {
                        smallpos = j;
                        smallval = q[1];
                    }
                }
                int[] q = network[smallpos];
                if (i != smallpos) {
                    int j = q[0]; q[0] = p[0]; p[0] = j;
                    j = q[1]; q[1] = p[1]; p[1] = j;
                    j = q[2]; q[2] = p[2]; p[2] = j;
                    j = q[3]; q[3] = p[3]; p[3] = j;
                }
                if (smallval != previouscol) {
                    netindex[previouscol] = (startpos + i) >> 1;
                    for (int j = previouscol + 1; j < smallval; j++) netindex[j] = i;
                    previouscol = smallval;
                    startpos = i;
                }
            }
            netindex[previouscol] = (startpos + maxnetpos) >> 1;
            for (int j = previouscol + 1; j < 256; j++) netindex[j] = maxnetpos;
        }

        public void learn() {
            int i;
            int lengthcount = this.lengthcount;
            int alphadec = 30 + ((samplefac - 1) / 3);
            byte[] p = thepicture;
            int pix = 0;
            int lim = lengthcount;
            int samplepixels = lengthcount / (3 * samplefac);
            int delta = samplepixels / ncycles;
            int alpha = initalpha;
            int radius = initradius;
            int rad = radius >> radiusbiasshift;
            if (rad <= 1) rad = 0;
            for (i = 0; i < rad; i++)
                radpower[i] = alpha * (((rad * rad - i * i) * radbias) / (rad * rad));
            int step;
            if (lengthcount < minpicturebytes) {
                samplefac = 1;
                step = 3;
            } else if ((lengthcount % prime1) != 0) {
                step = 3 * prime1;
            } else if ((lengthcount % prime2) != 0) {
                step = 3 * prime2;
            } else if ((lengthcount % prime3) != 0) {
                step = 3 * prime3;
            } else {
                step = 3 * prime4;
            }
            i = 0;
            while (i < samplepixels) {
                int r = (p[pix + 0] & 0xff) << netbiasshift;
                int g = (p[pix + 1] & 0xff) << netbiasshift;
                int b = (p[pix + 2] & 0xff) << netbiasshift;
                int j = contest(r, g, b);
                altersingle(alpha, j, r, g, b);
                if (rad != 0) alterneigh(rad, j, r, g, b);
                pix += step;
                if (pix >= lim) pix -= lengthcount;
                i++;
                if (delta == 0) delta = 1;
                if (i % delta == 0) {
                    alpha -= alpha / alphadec;
                    radius -= radius / radiusdec;
                    rad = radius >> radiusbiasshift;
                    if (rad <= 1) rad = 0;
                    for (j = 0; j < rad; j++)
                        radpower[j] = alpha * (((rad * rad - j * j) * radbias) / (rad * rad));
                }
            }
        }

        public int map(int r, int g, int b) {
            int bestd = 1000;
            int best = -1;
            int i = netindex[g];
            int j = i - 1;
            while ((i < netsize) || (j >= 0)) {
                if (i < netsize) {
                    int[] p = network[i];
                    int dist = p[1] - g;
                    if (dist >= bestd) i = netsize;
                    else {
                        i++;
                        if (dist < 0) dist = -dist;
                        int a = p[0] - r; if (a < 0) a = -a;
                        dist += a;
                        if (dist < bestd) {
                            a = p[2] - b; if (a < 0) a = -a;
                            dist += a;
                            if (dist < bestd) {
                                bestd = dist;
                                best = p[3];
                            }
                        }
                    }
                }
                if (j >= 0) {
                    int[] p = network[j];
                    int dist = g - p[1];
                    if (dist >= bestd) j = -1;
                    else {
                        j--;
                        if (dist < 0) dist = -dist;
                        int a = p[0] - r; if (a < 0) a = -a;
                        dist += a;
                        if (dist < bestd) {
                            a = p[2] - b; if (a < 0) a = -a;
                            dist += a;
                            if (dist < bestd) {
                                bestd = dist;
                                best = p[3];
                            }
                        }
                    }
                }
            }
            return (best);
        }

        public byte[] process() {
            learn();
            unbiasnet();
            inxbuild();
            return colorMap();
        }

        protected void unbiasnet() {
            for (int i = 0; i < netsize; i++) {
                network[i][0] >>= netbiasshift;
                network[i][1] >>= netbiasshift;
                network[i][2] >>= netbiasshift;
                network[i][3] = i;
            }
        }

        protected void altersingle(int alpha, int i, int r, int g, int b) {
            network[i][0] -= (alpha * (network[i][0] - r)) / initalpha;
            network[i][1] -= (alpha * (network[i][1] - g)) / initalpha;
            network[i][2] -= (alpha * (network[i][2] - b)) / initalpha;
        }

        protected void alterneigh(int rad, int i, int r, int g, int b) {
            int lo = i - rad; if (lo < -1) lo = -1;
            int hi = i + rad; if (hi > netsize) hi = netsize;
            int j = i + 1;
            int k = i - 1;
            int m = 1;
            while ((j < hi) || (k > lo)) {
                int a = radpower[m++];
                if (j < hi) {
                    int[] p = network[j++];
                    p[0] -= (a * (p[0] - r)) / alpharadbias;
                    p[1] -= (a * (p[1] - g)) / alpharadbias;
                    p[2] -= (a * (p[2] - b)) / alpharadbias;
                }
                if (k > lo) {
                    int[] p = network[k--];
                    p[0] -= (a * (p[0] - r)) / alpharadbias;
                    p[1] -= (a * (p[1] - g)) / alpharadbias;
                    p[2] -= (a * (p[2] - b)) / alpharadbias;
                }
            }
        }

        protected int contest(int r, int g, int b) {
            int bestd = ~(((int) 1) << 31);
            int bestbiasd = bestd;
            int bestpos = -1;
            int bestbiaspos = bestpos;
            for (int i = 0; i < netsize; i++) {
                int[] n = network[i];
                int dist = n[0] - r; if (dist < 0) dist = -dist;
                int a = n[1] - g; if (a < 0) a = -a;
                dist += a;
                a = n[2] - b; if (a < 0) a = -a;
                dist += a;
                if (dist < bestd) {
                    bestd = dist;
                    bestpos = i;
                }
                int biasdist = dist - ((bias[i]) >> (intbiasshift - netbiasshift));
                if (biasdist < bestbiasd) {
                    bestbiasd = biasdist;
                    bestbiaspos = i;
                }
                int betafreq = (freq[i] >> betashift);
                freq[i] -= betafreq;
                bias[i] += (betafreq << gammashift);
            }
            freq[bestpos] += beta;
            bias[bestpos] -= betagamma;
            return (bestbiaspos);
        }
    }

    public static class LzwEncoder {
        private static final int EOF = -1;
        private int imgW, imgH;
        private byte[] pixAry;
        private int initCodeSize;
        private int remaining;
        private int curPixel;

        static final int BITS = 12;
        static final int HSIZE = 5003;
        int n_bits;
        int maxbits = BITS;
        int maxcode;
        int maxmaxcode = 1 << BITS;
        int[] htab = new int[HSIZE];
        int[] codetab = new int[HSIZE];
        int hsize = HSIZE;
        int free_ent = 0;
        boolean clear_flg = false;
        int g_init_bits;
        int ClearCode;
        int EOFCode;
        int cur_accum = 0;
        int cur_bits = 0;
        int masks[] = {0x0000, 0x0001, 0x0003, 0x0007, 0x000F, 0x001F, 0x003F, 0x007F, 0x00FF, 0x01FF, 0x03FF, 0x07FF, 0x0FFF, 0x1FFF, 0x3FFF, 0x7FFF, 0xFFFF};
        int a_count;
        byte[] accum = new byte[256];

        public LzwEncoder(int width, int height, byte[] pixels, int color_depth) {
            imgW = width;
            imgH = height;
            pixAry = pixels;
            initCodeSize = Math.max(2, color_depth);
        }

        void char_out(byte c, OutputStream outs) throws IOException {
            accum[a_count++] = c;
            if (a_count >= 254) flush_char(outs);
        }

        void cl_block(OutputStream outs) throws IOException {
            cl_hash(hsize);
            free_ent = ClearCode + 2;
            clear_flg = true;
            output(ClearCode, outs);
        }

        void cl_hash(int hsize) {
            for (int i = 0; i < hsize; ++i) htab[i] = -1;
        }

        void compress(int init_bits, OutputStream outs) throws IOException {
            int fcode;
            int i = 0;
            int c;
            int ent;
            int disp;
            int hsize_reg;
            int hshift;

            g_init_bits = init_bits;
            clear_flg = false;
            n_bits = g_init_bits;
            maxcode = MAXCODE(n_bits);

            ClearCode = 1 << (init_bits - 1);
            EOFCode = ClearCode + 1;
            free_ent = ClearCode + 2;

            a_count = 0;
            ent = nextPixel();

            hshift = 0;
            for (fcode = hsize; fcode < 65536; fcode *= 2) ++hshift;
            hshift = 8 - hshift;
            hsize_reg = hsize;
            cl_hash(hsize_reg);

            output(ClearCode, outs);

            outer_loop: while ((c = nextPixel()) != EOF) {
                fcode = (c << maxbits) + ent;
                i = (c << hshift) ^ ent;
                if (htab[i] == fcode) {
                    ent = codetab[i];
                    continue;
                } else if (htab[i] >= 0) {
                    disp = hsize_reg - i;
                    if (i == 0) disp = 1;
                    do {
                        if ((i -= disp) < 0) i += hsize_reg;
                        if (htab[i] == fcode) {
                            ent = codetab[i];
                            continue outer_loop;
                        }
                    } while (htab[i] >= 0);
                }
                output(ent, outs);
                ent = c;
                if (free_ent < maxmaxcode) {
                    codetab[i] = free_ent++;
                    htab[i] = fcode;
                } else cl_block(outs);
            }
            output(ent, outs);
            output(EOFCode, outs);
        }

        public void encode(OutputStream os) throws IOException {
            os.write(initCodeSize);
            remaining = imgW * imgH;
            curPixel = 0;
            compress(initCodeSize + 1, os);
            os.write(0);
        }

        void flush_char(OutputStream outs) throws IOException {
            if (a_count > 0) {
                outs.write(a_count); // 写入本 sub-block 实际长度 (1..254)
                outs.write(accum, 0, a_count); // 写入本 sub-block 数据
                a_count = 0;
            }
        }

        final int MAXCODE(int n_bits) {
            return (1 << n_bits) - 1;
        }

        private int nextPixel() {
            if (remaining == 0) return EOF;
            --remaining;
            byte pix = pixAry[curPixel++];
            return pix & 0xff;
        }

        void output(int code, OutputStream outs) throws IOException {
            cur_accum &= masks[cur_bits];
            if (cur_bits > 0) cur_accum |= (code << cur_bits);
            else cur_accum = code;
            cur_bits += n_bits;
            while (cur_bits >= 8) {
                char_out((byte) (cur_accum & 0xff), outs);
                cur_accum >>= 8;
                cur_bits -= 8;
            }
            if (free_ent > maxcode || clear_flg) {
                if (clear_flg) {
                    maxcode = MAXCODE(n_bits = g_init_bits);
                    clear_flg = false;
                } else {
                    ++n_bits;
                    if (n_bits == maxbits) maxcode = maxmaxcode;
                    else maxcode = MAXCODE(n_bits);
                }
            }
            if (code == EOFCode) {
                while (cur_bits > 0) {
                    char_out((byte) (cur_accum & 0xff), outs);
                    cur_accum >>= 8;
                    cur_bits -= 8;
                }
                flush_char(outs);
            }
        }
    }
}
