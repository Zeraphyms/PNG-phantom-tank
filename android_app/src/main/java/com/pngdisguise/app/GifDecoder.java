package com.pngdisguise.app;

import android.graphics.Bitmap;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 健壮的轻量级 GIF 解码器，支持提取帧画面与对应延迟
 */
public class GifDecoder {

    public static class GifFrame {
        public final Bitmap bitmap;
        public final int delayMs;

        public GifFrame(Bitmap bitmap, int delayMs) {
            this.bitmap = bitmap;
            this.delayMs = delayMs;
        }
    }

    private static final int STATUS_OK = 0;
    private static final int STATUS_FORMAT_ERROR = 1;
    private static final int STATUS_OPEN_ERROR = 2;

    private static final int MAX_STACK_SIZE = 4096;

    private InputStream in;
    private int status;

    public int width;
    public int height;
    private boolean gctFlag;
    private int gctSize;
    private int loopCount = 0; // 0 = default infinite loop

    private int[] gct;
    private int[] lct;
    private int[] act;

    private int bgIndex;
    private int bgColor;
    private int lastBgColor;
    private int pixelAspect;

    private boolean lctFlag;
    private boolean interlace;
    private int lctSize;

    private int ix, iy, iw, ih;
    private int lrx, lry, lrw, lrh;
    private Bitmap image;
    private Bitmap lastBitmap;

    private byte[] block = new byte[256];
    private int blockSize = 0;

    // LZW decoder working arrays
    private short[] prefix;
    private byte[] suffix;
    private byte[] pixelStack;
    private byte[] pixels;

    private List<GifFrame> frames = new ArrayList<>();
    private int frameCount;

    private int dispose = 0;
    private int lastDispose = 0;
    private boolean transparency = false;
    private int delay = 0;
    private int transIndex;

    public int getLoopCount() {
        return loopCount;
    }

    public List<GifFrame> getFrames() {
        return frames;
    }

    public static boolean isGif(byte[] data) {
        if (data == null || data.length < 6) return false;
        String header = new String(data, 0, 6);
        return header.startsWith("GIF87a") || header.startsWith("GIF89a");
    }

    public int read(byte[] data) {
        if (data == null) return STATUS_OPEN_ERROR;
        return read(new ByteArrayInputStream(data));
    }

    public int read(InputStream is) {
        init();
        if (is != null) {
            this.in = is;
            readHeader();
            if (!err()) {
                readContents();
                if (frameCount < 0) {
                    status = STATUS_FORMAT_ERROR;
                }
            }
            try {
                is.close();
            } catch (Exception ignored) {}
        } else {
            status = STATUS_OPEN_ERROR;
        }
        return status;
    }

    private void init() {
        status = STATUS_OK;
        frameCount = 0;
        frames = new ArrayList<>();
        gct = null;
        lct = null;
    }

    private boolean err() {
        return status != STATUS_OK;
    }

    private int readByte() {
        int curByte = 0;
        try {
            curByte = in.read();
        } catch (Exception e) {
            status = STATUS_FORMAT_ERROR;
        }
        return curByte;
    }

    private int readBlock() {
        blockSize = readByte();
        int n = 0;
        if (blockSize > 0) {
            try {
                int count = 0;
                while (n < blockSize) {
                    count = in.read(block, n, blockSize - n);
                    if (count == -1) break;
                    n += count;
                }
            } catch (Exception ignored) {}
            if (n < blockSize) {
                status = STATUS_FORMAT_ERROR;
            }
        }
        return n;
    }

    private int[] readColorTable(int ncolors) {
        int nbytes = 3 * ncolors;
        int[] tab = null;
        byte[] c = new byte[nbytes];
        int n = 0;
        try {
            while (n < nbytes) {
                int count = in.read(c, n, nbytes - n);
                if (count == -1) break;
                n += count;
            }
        } catch (Exception ignored) {}
        if (n < nbytes) {
            status = STATUS_FORMAT_ERROR;
        } else {
            tab = new int[256];
            int i = 0;
            int j = 0;
            while (i < ncolors) {
                int r = ((int) c[j++]) & 0xff;
                int g = ((int) c[j++]) & 0xff;
                int b = ((int) c[j++]) & 0xff;
                tab[i++] = 0xff000000 | (r << 16) | (g << 8) | b;
            }
        }
        return tab;
    }

    private void readContents() {
        boolean done = false;
        while (!done && !err()) {
            int code = readByte();
            switch (code) {
                case 0x2C: // Image Separator
                    readBitmap();
                    break;
                case 0x21: // Extension
                    code = readByte();
                    switch (code) {
                        case 0xf9: // Graphic Control Extension
                            readGraphicControlExt();
                            break;
                        case 0xff: // Application Extension
                            readBlock();
                            StringBuilder app = new StringBuilder();
                            for (int i = 0; i < 11; i++) {
                                app.append((char) block[i]);
                            }
                            if (app.toString().equals("NETSCAPE2.0")) {
                                readNetscapeExt();
                            } else {
                                skip();
                            }
                            break;
                        default:
                            skip();
                    }
                    break;
                case 0x3b: // Terminator
                    done = true;
                    break;
                case 0x00: // Bad byte, ignore
                    break;
                default:
                    status = STATUS_FORMAT_ERROR;
            }
        }
    }

    private void readGraphicControlExt() {
        readByte(); // Block size (always 4)
        int packed = readByte();
        dispose = (packed & 0x1c) >> 2;
        if (dispose == 0) dispose = 1;
        transparency = (packed & 1) != 0;
        delay = readShort() * 10; // convert 1/100 sec to ms
        if (delay <= 0) delay = 100;
        transIndex = readByte();
        readByte(); // Block terminator
    }

    private void readHeader() {
        StringBuilder id = new StringBuilder();
        for (int i = 0; i < 6; i++) {
            id.append((char) readByte());
        }
        if (!id.toString().startsWith("GIF")) {
            status = STATUS_FORMAT_ERROR;
            return;
        }
        readLSD();
        if (gctFlag && !err()) {
            gct = readColorTable(gctSize);
            bgColor = gct[bgIndex];
        }
    }

    private void readLSD() {
        width = readShort();
        height = readShort();
        int packed = readByte();
        gctFlag = (packed & 0x80) != 0;
        gctSize = 2 << (packed & 7);
        bgIndex = readByte();
        pixelAspect = readByte();
    }

    private void readNetscapeExt() {
        do {
            readBlock();
            if (block[0] == 1) {
                int b1 = ((int) block[1]) & 0xff;
                int b2 = ((int) block[2]) & 0xff;
                loopCount = (b2 << 8) | b1;
            }
        } while (blockSize > 0 && !err());
    }

    private int readShort() {
        return readByte() | (readByte() << 8);
    }

    private void readBitmap() {
        ix = readShort();
        iy = readShort();
        iw = readShort();
        ih = readShort();
        int packed = readByte();
        lctFlag = (packed & 0x80) != 0;
        interlace = (packed & 0x40) != 0;
        lctSize = 2 << (packed & 7);
        if (lctFlag) {
            lct = readColorTable(lctSize);
            act = lct;
        } else {
            act = gct;
            if (bgIndex == transIndex) bgColor = 0;
        }
        int save = 0;
        if (transparency) {
            save = act[transIndex];
            act[transIndex] = 0;
        }
        if (act == null) {
            status = STATUS_FORMAT_ERROR;
        }
        if (err()) return;

        decodeBitmapData();
        skip();
        if (err()) return;

        frameCount++;
        image = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        setPixels();
        frames.add(new GifFrame(image, delay));

        if (transparency) {
            act[transIndex] = save;
        }
        resetFrame();
    }

    private void resetFrame() {
        lastDispose = dispose;
        lrx = ix;
        lry = iy;
        lrw = iw;
        lrh = ih;
        lastBitmap = image;
        lastBgColor = bgColor;
        dispose = 0;
        transparency = false;
        delay = 0;
        lct = null;
    }

    private void setPixels() {
        int[] dest = new int[width * height];
        if (lastDispose > 0) {
            if (lastDispose == 3) {
                // Restore to previous
                int n = frameCount - 2;
                if (n > 0) {
                    lastBitmap = frames.get(n - 1).bitmap;
                } else {
                    lastBitmap = null;
                }
            }
            if (lastBitmap != null) {
                lastBitmap.getPixels(dest, 0, width, 0, 0, width, height);
                if (lastDispose == 2) {
                    // Restore to background color
                    int c = 0;
                    if (!transparency) c = lastBgColor;
                    for (int i = 0; i < lrh; i++) {
                        int n1 = (lry + i) * width + lrx;
                        int n2 = n1 + lrw;
                        for (int k = n1; k < n2; k++) {
                            dest[k] = c;
                        }
                    }
                }
            }
        }

        // Fill in current image pixels
        int pass = 1;
        int inc = 8;
        int iline = 0;
        for (int i = 0; i < ih; i++) {
            int line = i;
            if (interlace) {
                if (iline >= ih) {
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
            line += iy;
            if (line < height) {
                int k = line * width;
                int dx = k + ix;
                int dlim = dx + iw;
                if (k + width < dlim) dlim = k + width;
                int sx = i * iw;
                while (dx < dlim) {
                    int index = ((int) pixels[sx++]) & 0xff;
                    if (!transparency || index != transIndex) {
                        dest[dx] = act[index];
                    }
                    dx++;
                }
            }
        }
        image.setPixels(dest, 0, width, 0, 0, width, height);
    }

    private void decodeBitmapData() {
        int nullCode = -1;
        int npix = iw * ih;
        if (pixels == null || pixels.length < npix) {
            pixels = new byte[npix];
        }
        if (prefix == null) prefix = new short[MAX_STACK_SIZE];
        if (suffix == null) suffix = new byte[MAX_STACK_SIZE];
        if (pixelStack == null) pixelStack = new byte[MAX_STACK_SIZE + 1];

        int dataSize = readByte();
        int clear = 1 << dataSize;
        int endOfInfo = clear + 1;
        int available = clear + 2;
        int oldCode = nullCode;
        int codeSize = dataSize + 1;
        int codeMask = (1 << codeSize) - 1;
        for (int code = 0; code < clear; code++) {
            prefix[code] = 0;
            suffix[code] = (byte) code;
        }

        int bi = 0, pi = 0, top = 0, first = 0, count = 0, bits = 0, datum = 0;
        for (int i = 0; i < npix; ) {
            if (top == 0) {
                if (bits < codeSize) {
                    if (count == 0) {
                        count = readBlock();
                        if (count <= 0) break;
                        bi = 0;
                    }
                    datum += (((int) block[bi++]) & 0xff) << bits;
                    bits += 8;
                    count--;
                    continue;
                }
                int code = datum & codeMask;
                datum >>= codeSize;
                bits -= codeSize;

                if (code > available || code == endOfInfo) break;
                if (code == clear) {
                    codeSize = dataSize + 1;
                    codeMask = (1 << codeSize) - 1;
                    available = clear + 2;
                    oldCode = nullCode;
                    continue;
                }
                if (oldCode == nullCode) {
                    if (top < pixelStack.length) pixelStack[top++] = suffix[code];
                    oldCode = code;
                    first = code;
                    continue;
                }
                int inCode = code;
                if (code == available) {
                    if (top < pixelStack.length) pixelStack[top++] = (byte) first;
                    code = oldCode;
                }
                while (code > clear) {
                    if (top < pixelStack.length) pixelStack[top++] = suffix[code];
                    code = prefix[code];
                }
                first = ((int) suffix[code]) & 0xff;
                if (top < pixelStack.length) {
                    if (top < pixelStack.length) pixelStack[top++] = (byte) first;
                }
                if (available < MAX_STACK_SIZE) {
                    prefix[available] = (short) oldCode;
                    suffix[available] = (byte) first;
                    available++;
                    if ((available & codeMask) == 0 && available < MAX_STACK_SIZE) {
                        codeSize++;
                        codeMask += available;
                    }
                }
                oldCode = inCode;
            }
            if (top > 0) {
                top--;
                if (pi < pixels.length) {
                    pixels[pi++] = pixelStack[top];
                }
            }
            i++;
        }
        for (int i = pi; i < npix; i++) {
            pixels[i] = 0; // clear unwritten pixels
        }
    }

    private void skip() {
        do {
            readBlock();
        } while (blockSize > 0 && !err());
    }
}
