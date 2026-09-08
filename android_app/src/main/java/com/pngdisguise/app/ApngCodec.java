package com.pngdisguise.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.zip.CRC32;
import java.util.zip.Deflater;

public class ApngCodec {

    public static final byte[] PNG_SIG = new byte[] {
        (byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
    };
    public static final String MARKER_KEYWORD = "ChatBarApngDisguise";
    public static final int FORMAT_VERSION = 1;
    public static final int MAX_SUPPORTED_VERSION = 2;

    public static class CodecException extends Exception {
        public CodecException(String message) {
            super(message);
        }
    }

    public static class Chunk {
        public final byte[] type;
        public final byte[] payload;

        public Chunk(byte[] type, byte[] payload) {
            this.type = type;
            this.payload = payload;
        }

        public String getTypeName() {
            return new String(type, StandardCharsets.ISO_8859_1);
        }
    }

    public static class DisguiseMeta {
        public final int version;
        public final String kind; // "STATIC" or "ANIMATED"
        public final int count;

        public DisguiseMeta(int version, String kind, int count) {
            this.version = version;
            this.kind = kind;
            this.count = count;
        }
    }

    public static class DisguiseInfo {
        public final int width;
        public final int height;
        public final DisguiseMeta meta;
        public final List<Chunk> chunks;

        public DisguiseInfo(int width, int height, DisguiseMeta meta, List<Chunk> chunks) {
            this.width = width;
            this.height = height;
            this.meta = meta;
            this.chunks = chunks;
        }
    }

    public static byte[] chunkBytes(byte[] ctype, byte[] data) {
        int len = (data != null) ? data.length : 0;
        CRC32 crc = new CRC32();
        crc.update(ctype);
        if (len > 0) {
            crc.update(data);
        }
        long crcVal = crc.getValue() & 0xFFFFFFFFL;

        byte[] out = new byte[4 + 4 + len + 4];
        ByteBuffer bb = ByteBuffer.wrap(out).order(ByteOrder.BIG_ENDIAN);
        bb.putInt(len);
        bb.put(ctype);
        if (len > 0) {
            bb.put(data);
        }
        bb.putInt((int) crcVal);
        return out;
    }

    public static byte[] filterRows(int width, int height, byte[] rgba) {
        int rowStride = width * 4;
        byte[] filtered = new byte[height * (rowStride + 1)];
        int srcPos = 0;
        int dstPos = 0;
        for (int y = 0; y < height; y++) {
            filtered[dstPos++] = 0; // Filter type 0 (None)
            System.arraycopy(rgba, srcPos, filtered, dstPos, rowStride);
            srcPos += rowStride;
            dstPos += rowStride;
        }
        return filtered;
    }

    public static class ApngWriter {
        private final int width;
        private final int height;
        private final int declared;
        private int written = 0;
        private final ByteArrayOutputStream chunks = new ByteArrayOutputStream();
        private int seq = 0;

        public ApngWriter(int width, int height, int animationFrames, int playCount,
                          String contentKind, int contentFrameCount) throws IOException {
            this.width = width;
            this.height = height;
            this.declared = animationFrames;

            chunks.write(PNG_SIG);

            // IHDR: width(4), height(4), bitDepth=8(1), colorType=6(1, RGBA), comp=0, filter=0, interlace=0
            byte[] ihdr = new byte[13];
            ByteBuffer bbIhdr = ByteBuffer.wrap(ihdr).order(ByteOrder.BIG_ENDIAN);
            bbIhdr.putInt(width);
            bbIhdr.putInt(height);
            bbIhdr.put((byte) 8);
            bbIhdr.put((byte) 6); // RGBA
            bbIhdr.put((byte) 0);
            bbIhdr.put((byte) 0);
            bbIhdr.put((byte) 0);
            chunks.write(chunkBytes("IHDR".getBytes(StandardCharsets.ISO_8859_1), ihdr));

            // acTL: animation_frames(4), play_count(4)
            byte[] actl = new byte[8];
            ByteBuffer bbActl = ByteBuffer.wrap(actl).order(ByteOrder.BIG_ENDIAN);
            bbActl.putInt(animationFrames);
            bbActl.putInt(playCount);
            chunks.write(chunkBytes("acTL".getBytes(StandardCharsets.ISO_8859_1), actl));

            // tEXt marker: "ChatBarApngDisguise\0version;kind;count"
            String markerStr = FORMAT_VERSION + ";" + contentKind + ";" + contentFrameCount;
            byte[] markerKey = MARKER_KEYWORD.getBytes(StandardCharsets.US_ASCII);
            byte[] markerPayload = markerStr.getBytes(StandardCharsets.US_ASCII);
            byte[] textPayload = new byte[markerKey.length + 1 + markerPayload.length];
            System.arraycopy(markerKey, 0, textPayload, 0, markerKey.length);
            textPayload[markerKey.length] = 0;
            System.arraycopy(markerPayload, 0, textPayload, markerKey.length + 1, markerPayload.length);
            chunks.write(chunkBytes("tEXt".getBytes(StandardCharsets.ISO_8859_1), textPayload));
        }

        private void writeImageData(int fw, int fh, byte[] rgba, boolean isDefault) throws IOException {
            byte[] filtered = filterRows(fw, fh, rgba);
            Deflater deflater = new Deflater(6);
            deflater.setInput(filtered);
            deflater.finish();

            ByteArrayOutputStream compressed = new ByteArrayOutputStream();
            byte[] buffer = new byte[65536];
            while (!deflater.finished()) {
                int count = deflater.deflate(buffer);
                compressed.write(buffer, 0, count);
            }
            deflater.end();
            byte[] comp = compressed.toByteArray();

            int chunkSize = 65536;
            for (int i = 0; i < comp.length; i += chunkSize) {
                int pieceLen = Math.min(chunkSize, comp.length - i);
                byte[] piece = Arrays.copyOfRange(comp, i, i + pieceLen);
                if (isDefault) {
                    chunks.write(chunkBytes("IDAT".getBytes(StandardCharsets.ISO_8859_1), piece));
                } else {
                    byte[] fdatPayload = new byte[4 + piece.length];
                    ByteBuffer bbFdat = ByteBuffer.wrap(fdatPayload).order(ByteOrder.BIG_ENDIAN);
                    bbFdat.putInt(seq++);
                    bbFdat.put(piece);
                    chunks.write(chunkBytes("fdAT".getBytes(StandardCharsets.ISO_8859_1), fdatPayload));
                }
            }
        }

        public void writeDefault(byte[] rgba) throws IOException {
            writeImageData(this.width, this.height, rgba, true);
        }

        public void writeFrame(int fw, int fh, byte[] rgba, int x, int y,
                               int delayNum, int delayDen, int dispose, int blend) throws IOException, CodecException {
            if (written >= declared) {
                throw new CodecException("Frame count exceeded declared frames");
            }
            byte[] fctl = new byte[26];
            ByteBuffer bb = ByteBuffer.wrap(fctl).order(ByteOrder.BIG_ENDIAN);
            bb.putInt(seq++);
            bb.putInt(fw);
            bb.putInt(fh);
            bb.putInt(x);
            bb.putInt(y);
            bb.putShort((short) delayNum);
            bb.putShort((short) delayDen);
            bb.put((byte) dispose);
            bb.put((byte) blend);
            chunks.write(chunkBytes("fcTL".getBytes(StandardCharsets.ISO_8859_1), fctl));

            writeImageData(fw, fh, rgba, false);
            written++;
        }

        public byte[] finish() throws IOException, CodecException {
            if (written != declared) {
                throw new CodecException("Declared frame count does not match written frame count");
            }
            chunks.write(chunkBytes("IEND".getBytes(StandardCharsets.ISO_8859_1), new byte[0]));
            return chunks.toByteArray();
        }
    }

    public static List<Chunk> parseChunks(byte[] data) throws CodecException {
        if (data == null || data.length < 8) {
            throw new CodecException("Invalid PNG file (too short)");
        }
        for (int i = 0; i < 8; i++) {
            if (data[i] != PNG_SIG[i]) {
                throw new CodecException("Invalid PNG signature");
            }
        }
        List<Chunk> chunks = new ArrayList<>();
        int pos = 8;
        ByteBuffer bb = ByteBuffer.wrap(data).order(ByteOrder.BIG_ENDIAN);
        while (pos + 8 <= data.length) {
            int length = bb.getInt(pos);
            if (length < 0 || pos + 12 + length > data.length) {
                throw new CodecException("PNG chunk out of bounds");
            }
            byte[] type = Arrays.copyOfRange(data, pos + 4, pos + 8);
            byte[] payload = Arrays.copyOfRange(data, pos + 8, pos + 8 + length);
            chunks.add(new Chunk(type, payload));
            pos += 12 + length;
            if (new String(type, StandardCharsets.ISO_8859_1).equals("IEND")) {
                break;
            }
        }
        return chunks;
    }

    public static DisguiseInfo inspectDisguise(byte[] data) {
        try {
            List<Chunk> chunks = parseChunks(data);
            boolean hasAcTL = false;
            for (Chunk c : chunks) {
                if (c.getTypeName().equals("acTL")) {
                    hasAcTL = true;
                    break;
                }
            }
            if (!hasAcTL) return null;

            DisguiseMeta meta = null;
            byte[] markerKeyBytes = MARKER_KEYWORD.getBytes(StandardCharsets.US_ASCII);
            for (Chunk c : chunks) {
                if (c.getTypeName().equals("tEXt")) {
                    byte[] payload = c.payload;
                    if (payload.length > markerKeyBytes.length + 1) {
                        boolean match = true;
                        for (int i = 0; i < markerKeyBytes.length; i++) {
                            if (payload[i] != markerKeyBytes[i]) {
                                match = false;
                                break;
                            }
                        }
                        if (match && payload[markerKeyBytes.length] == 0) {
                            String val = new String(payload, markerKeyBytes.length + 1,
                                    payload.length - (markerKeyBytes.length + 1), StandardCharsets.US_ASCII);
                            String[] parts = val.split(";");
                            if (parts.length == 3 && parts[0].matches("\\d+")) {
                                meta = new DisguiseMeta(Integer.parseInt(parts[0]), parts[1], Integer.parseInt(parts[2]));
                                break;
                            }
                        }
                    }
                }
            }
            if (meta == null) return null;

            int width = 0;
            int height = 0;
            for (Chunk c : chunks) {
                if (c.getTypeName().equals("IHDR")) {
                    ByteBuffer bb = ByteBuffer.wrap(c.payload).order(ByteOrder.BIG_ENDIAN);
                    width = bb.getInt(0);
                    height = bb.getInt(4);
                    break;
                }
            }

            return new DisguiseInfo(width, height, meta, chunks);
        } catch (Exception e) {
            return null;
        }
    }

    private static class FrameGroup {
        byte[] fcTL;
        List<byte[]> fdatPieces = new ArrayList<>();

        FrameGroup(byte[] fcTL) {
            this.fcTL = fcTL;
        }
    }

    private static List<FrameGroup> extractFrameGroups(List<Chunk> chunks) {
        List<FrameGroup> groups = new ArrayList<>();
        FrameGroup cur = null;
        for (Chunk c : chunks) {
            String name = c.getTypeName();
            if (name.equals("IDAT")) {
                // skip default frame IDATs
                continue;
            } else if (name.equals("fcTL")) {
                cur = new FrameGroup(c.payload);
                groups.add(cur);
            } else if (name.equals("fdAT")) {
                if (cur != null && c.payload.length >= 4) {
                    // strip 4-byte sequence number from fdAT
                    cur.fdatPieces.add(Arrays.copyOfRange(c.payload, 4, c.payload.length));
                }
            }
        }
        return groups;
    }

    public static byte[] restoreDisguise(byte[] data) throws CodecException, IOException {
        DisguiseInfo info = inspectDisguise(data);
        if (info == null || (!"STATIC".equals(info.meta.kind) && !"ANIMATED".equals(info.meta.kind))) {
            throw new CodecException("不是可还原的伪装 APNG 文件");
        }

        List<Chunk> chunks = info.chunks;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(PNG_SIG);

        byte[] ihdr = null;
        for (Chunk c : chunks) {
            if (c.getTypeName().equals("IHDR")) {
                ihdr = c.payload;
                break;
            }
        }
        if (ihdr == null) {
            throw new CodecException("缺少 IHDR 数据块");
        }
        out.write(chunkBytes("IHDR".getBytes(StandardCharsets.ISO_8859_1), ihdr));

        List<FrameGroup> frameGroups = extractFrameGroups(chunks);
        if (frameGroups.isEmpty()) {
            throw new CodecException("伪装文件中未找到隐藏的图像数据帧");
        }

        if ("ANIMATED".equals(info.meta.kind)) {
            byte[] acTL = null;
            for (Chunk c : chunks) {
                if (c.getTypeName().equals("acTL")) {
                    acTL = c.payload;
                    break;
                }
            }
            int playCount = 0;
            if (acTL != null && acTL.length >= 8) {
                ByteBuffer bb = ByteBuffer.wrap(acTL).order(ByteOrder.BIG_ENDIAN);
                bb.getInt(0); // ignore original frame count
                playCount = bb.getInt(4);
            }
            int frameCount = frameGroups.size();
            byte[] newAcTL = new byte[8];
            ByteBuffer bbAcTL = ByteBuffer.wrap(newAcTL).order(ByteOrder.BIG_ENDIAN);
            bbAcTL.putInt(frameCount);
            bbAcTL.putInt(playCount);
            out.write(chunkBytes("acTL".getBytes(StandardCharsets.ISO_8859_1), newAcTL));

            int seq = 0;
            for (int i = 0; i < frameGroups.size(); i++) {
                FrameGroup group = frameGroups.get(i);
                byte[] fctlData = Arrays.copyOf(group.fcTL, group.fcTL.length);
                ByteBuffer.wrap(fctlData).order(ByteOrder.BIG_ENDIAN).putInt(0, seq++);
                out.write(chunkBytes("fcTL".getBytes(StandardCharsets.ISO_8859_1), fctlData));

                for (byte[] piece : group.fdatPieces) {
                    if (i == 0) {
                        out.write(chunkBytes("IDAT".getBytes(StandardCharsets.ISO_8859_1), piece));
                    } else {
                        byte[] fdatPayload = new byte[4 + piece.length];
                        ByteBuffer bbFdat = ByteBuffer.wrap(fdatPayload).order(ByteOrder.BIG_ENDIAN);
                        bbFdat.putInt(seq++);
                        bbFdat.put(piece);
                        out.write(chunkBytes("fdAT".getBytes(StandardCharsets.ISO_8859_1), fdatPayload));
                    }
                }
            }
            out.write(chunkBytes("IEND".getBytes(StandardCharsets.ISO_8859_1), new byte[0]));
            return out.toByteArray();
        } else {
            // STATIC mode
            FrameGroup firstGroup = frameGroups.get(0);
            for (byte[] piece : firstGroup.fdatPieces) {
                out.write(chunkBytes("IDAT".getBytes(StandardCharsets.ISO_8859_1), piece));
            }
            out.write(chunkBytes("IEND".getBytes(StandardCharsets.ISO_8859_1), new byte[0]));
            return out.toByteArray();
        }
    }
}
